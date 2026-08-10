import type pg from 'pg';
import type { CircleTreasuryProvider } from '../payments/circle-provider.js';
import { getOrgPaymentMode } from '../payments/store.js';
import { payIntraFleet } from '../payments/intra-fleet.js';
import { resolveClientAgentAuth } from '../marketplace/store.js';
import { onboardRuntime } from '../runtime/store.js';
import { recordActivity } from '../approvals/store.js';
import { IdentityError } from '../identity/errors.js';
import {
  appendFleetRunEvent,
  getFleetRun,
  markChecklistItem,
  updateFleetRunState,
} from './store.js';
import { probeEndpoint } from './resolve-agents.js';
import { seededDataFetcher, seededPayloadForRole } from './demo-payloads.js';
import type { FleetChecklistItem, FleetResolvedAgent, FleetRunRecord } from './types.js';
import { narrateAssistantOpening, narratePlan, narrateFruit } from './gemini.js';

async function findRecentSecondHopTx(
  pool: pg.Pool,
  orgId: string,
  analystAgentId: string,
  dataFetcherAgentId: string,
): Promise<{ txHash: string; amountUsdc: string } | null> {
  const result = await pool.query<{ tx_hash: string; amount_usdc: string }>(
    `SELECT result->>'tx_hash' AS tx_hash, amount_usdc::text AS amount_usdc
       FROM payment_events
      WHERE org_id = $1
        AND agent_id = $2
        AND coalesce(result->>'payee_agent_id', '') = $3
        AND coalesce(result->>'lane', '') = 'permit2_intra_fleet'
        AND created_at > now() - interval '15 minutes'
      ORDER BY created_at DESC
      LIMIT 1`,
    [orgId, analystAgentId, dataFetcherAgentId],
  );
  const row = result.rows[0];
  if (row === undefined || typeof row.tx_hash !== 'string' || !row.tx_hash.startsWith('0x')) {
    return null;
  }
  return { txHash: row.tx_hash, amountUsdc: row.amount_usdc };
}

async function setItem(
  pool: pg.Pool,
  run: FleetRunRecord,
  checklist: FleetChecklistItem[],
  id: string,
  status: FleetChecklistItem['status'],
): Promise<FleetChecklistItem[]> {
  const next = markChecklistItem(checklist, id, status);
  await updateFleetRunState(pool, {
    orgId: run.orgId,
    runId: run.id,
    checklist: next,
  });
  return next;
}

function requireAgent(
  agents: FleetRunRecord['agents'],
  role: keyof FleetRunRecord['agents'],
): FleetResolvedAgent {
  const agent = agents[role];
  if (agent === undefined) {
    throw new IdentityError('fleet_agents_incomplete', 409, `Chat run missing agent role: ${String(role)}`);
  }
  return agent;
}

export async function executeFleetRun(
  pool: pg.Pool,
  provider: CircleTreasuryProvider,
  input: {
    readonly orgId: string;
    readonly runId: string;
    readonly actorId: string;
  },
): Promise<FleetRunRecord> {
  const run = await getFleetRun(pool, input.orgId, input.runId);
  if (run.status === 'completed') return run;
  if (run.status === 'running') {
    throw new IdentityError('fleet_run_busy', 409, 'This chat run is already in progress.');
  }

  await updateFleetRunState(pool, {
    orgId: input.orgId,
    runId: input.runId,
    status: 'running',
  });

  let checklist = [...run.checklist] as FleetChecklistItem[];
  const orch = requireAgent(run.agents, 'orchestrator');
  const dataFetcher = requireAgent(run.agents, 'data_fetcher');
  const analyst = requireAgent(run.agents, 'analyst');
  const writer = requireAgent(run.agents, 'writer');
  const reviewer = requireAgent(run.agents, 'senior_reviewer');

  const receipts: Array<Record<string, unknown>> = [];
  const payloads: Record<string, unknown> = {};
  let dataFetcherSeed = seededDataFetcher(run.goal);

  try {
    const opening = await narrateAssistantOpening(run.goal);
    await appendFleetRunEvent(pool, {
      orgId: input.orgId,
      runId: input.runId,
      kind: 'assistant',
      tool: 'gemini.chat',
      payload: { text: opening },
    });

    const planText = await narratePlan(run.goal, checklist);
    await appendFleetRunEvent(pool, {
      orgId: input.orgId,
      runId: input.runId,
      kind: 'plan',
      tool: 'gemini.plan',
      payload: { text: planText, checklist },
    });

    checklist = await setItem(pool, run, checklist, 'onboard', 'running');
    const orchAuth = await resolveClientAgentAuth(pool, input.orgId, orch.agentId);
    const onboard = await onboardRuntime(pool, orchAuth);
    checklist = await setItem(pool, run, checklist, 'onboard', 'done');
    await appendFleetRunEvent(pool, {
      orgId: input.orgId,
      runId: input.runId,
      kind: 'tool',
      tool: 'agentops.onboard',
      payload: {
        agent_id: orch.agentId,
        connection_id: orchAuth.connection_id,
        contract_keys: Object.keys(onboard ?? {}),
      },
    });

    checklist = await setItem(pool, run, checklist, 'wire', 'running');
    const live: Record<string, boolean> = {};
    for (const agent of [dataFetcher, analyst, writer, reviewer]) {
      live[agent.name] = await probeEndpoint(agent.endpointUrl);
    }
    const dead = Object.entries(live).filter(([, ok]) => !ok).map(([name]) => name);
    const catalogMode = dead.length > 0;
    const requireLive =
      process.env.FLEET_REQUIRE_LIVE_SELLERS === '1'
      || process.env.FLEET_REQUIRE_LIVE_SELLERS === 'true';
    checklist = await setItem(pool, run, checklist, 'wire', 'done');
    await appendFleetRunEvent(pool, {
      orgId: input.orgId,
      runId: input.runId,
      kind: 'wire',
      tool: 'listing.resolve',
      payload: {
        live,
        catalog_mode: catalogMode,
        note: catalogMode
          ? `Some agents are offline (${dead.join(', ')}). I'll still fulfill your request from the agent catalog; on-chain receipts appear when those services are live.`
          : 'All specialist services are reachable — settling with live payments.',
      },
    });
    if (catalogMode && requireLive) {
      throw new IdentityError(
        'fleet_sellers_offline',
        409,
        `Fleet sellers offline (${dead.join(', ')}). Start them (npm run dev:fleet-sellers or Docker fleet-sellers) with DEMO_ORG_ID matching this org, then retry Chat. Catalog mode is disabled (FLEET_REQUIRE_LIVE_SELLERS).`,
      );
    }
    if (catalogMode) {
      await appendFleetRunEvent(pool, {
        orgId: input.orgId,
        runId: input.runId,
        kind: 'assistant',
        tool: 'gemini.chat',
        payload: {
          text:
            dead.length === 4
              ? `Those specialist endpoints aren't online right now, so I'll fulfill this from the agent catalog and still give you a full answer. Start sellers later if you want live Arc/Base receipts.`
              : `I couldn't reach ${dead.join(', ')} — I'll use the catalog for those and live settlement for the rest.`,
        },
      });
    }

    const mode = (await getOrgPaymentMode(pool, input.orgId)).mode;

    async function hire(stepId: string, payee: FleetResolvedAgent, chain: 'arc' | 'base') {
      checklist = await setItem(pool, run, checklist, stepId, 'running');
      await appendFleetRunEvent(pool, {
        orgId: input.orgId,
        runId: input.runId,
        kind: 'step_start',
        tool: live[payee.name] ? 'agentops.payment_intra_fleet' : 'agent.catalog',
        payload: {
          payer: orch.name,
          payee: payee.name,
          chain,
          url: payee.endpointUrl,
        },
      });

      if (!live[payee.name]) {
        const body = seededPayloadForRole(payee.role, run.goal, dataFetcherSeed);
        if (payee.role === 'data_fetcher') {
          dataFetcherSeed = (body.data as typeof dataFetcherSeed) ?? dataFetcherSeed;
        }
        payloads[payee.role] = body;
        checklist = await setItem(pool, run, checklist, stepId, 'done');
        await appendFleetRunEvent(pool, {
          orgId: input.orgId,
          runId: input.runId,
          kind: 'service',
          tool: 'agent.catalog',
          payload: {
            payee_agent_id: payee.agentId,
            payee: payee.name,
            chain,
            fulfillment: 'catalog',
            body,
          },
        });
        return null;
      }

      const payment = await payIntraFleet(pool, provider, {
        orgId: input.orgId,
        payerAgentId: orch.agentId,
        payeeAgentId: payee.agentId,
        mode,
        chain,
        url: payee.endpointUrl,
        approvedBy: input.actorId,
        connectionId: orchAuth.connection_id,
      });
      receipts.push({
        step: stepId,
        payer: orch.name,
        payee: payee.name,
        chain,
        amountUsdc: payment.amountUsdc,
        txHash: payment.txHash,
        tool: 'agentops.payment_intra_fleet',
      });
      payloads[payee.role] = payment.body;
      checklist = await setItem(pool, run, checklist, stepId, 'done');
      await appendFleetRunEvent(pool, {
        orgId: input.orgId,
        runId: input.runId,
        kind: 'payment',
        tool: 'agentops.payment_intra_fleet',
        payload: {
          payer_agent_id: orch.agentId,
          payee_agent_id: payee.agentId,
          chain,
          amount_usdc: payment.amountUsdc,
          tx_hash: payment.txHash,
          body: payment.body,
        },
      });
      return payment;
    }

    await hire('pay_data_fetcher', dataFetcher, 'arc');
    await hire('pay_analyst', analyst, 'arc');

    checklist = await setItem(pool, run, checklist, 'second_hop', 'running');
    if (live.Analyst && live.DataFetcher) {
      let second = await findRecentSecondHopTx(pool, input.orgId, analyst.agentId, dataFetcher.agentId);
      if (second === null) {
        const analystAuth = await resolveClientAgentAuth(pool, input.orgId, analyst.agentId);
        const payment = await payIntraFleet(pool, provider, {
          orgId: input.orgId,
          payerAgentId: analyst.agentId,
          payeeAgentId: dataFetcher.agentId,
          mode,
          chain: 'arc',
          url: dataFetcher.endpointUrl,
          approvedBy: input.actorId,
          connectionId: analystAuth.connection_id,
        });
        second = { txHash: payment.txHash, amountUsdc: payment.amountUsdc };
      }
      receipts.push({
        step: 'second_hop',
        payer: analyst.name,
        payee: dataFetcher.name,
        chain: 'arc',
        amountUsdc: second.amountUsdc,
        txHash: second.txHash,
        tool: 'agentops.payment_intra_fleet',
      });
      await appendFleetRunEvent(pool, {
        orgId: input.orgId,
        runId: input.runId,
        kind: 'payment',
        tool: 'agentops.payment_intra_fleet',
        payload: {
          payer_agent_id: analyst.agentId,
          payee_agent_id: dataFetcher.agentId,
          chain: 'arc',
          amount_usdc: second.amountUsdc,
          tx_hash: second.txHash,
          second_hop: true,
        },
      });
    } else {
      await appendFleetRunEvent(pool, {
        orgId: input.orgId,
        runId: input.runId,
        kind: 'service',
        tool: 'agent.catalog',
        payload: {
          second_hop: true,
          fulfillment: 'catalog',
          note: 'Second-hop Analyst→DataFetcher recorded in analysis payload (sellers offline).',
        },
      });
    }
    checklist = await setItem(pool, run, checklist, 'second_hop', 'done');

    await hire('pay_writer', writer, 'arc');
    await hire('pay_reviewer', reviewer, 'base');

    checklist = await setItem(pool, run, checklist, 'activity', 'running');
    const brief = await narrateFruit(run.goal, payloads, receipts);
    await recordActivity(pool, {
      orgId: input.orgId,
      agentId: orch.agentId,
      connectionId: orchAuth.connection_id,
      category: 'integration',
      action: 'fleet_run.completed',
      outcome: 'success',
      summary: `Chat run ${input.runId}: ${brief.slice(0, 240)}`,
      payload: { run_id: input.runId, receipts, catalog_mode: catalogMode },
    });
    checklist = await setItem(pool, run, checklist, 'activity', 'done');
    await appendFleetRunEvent(pool, {
      orgId: input.orgId,
      runId: input.runId,
      kind: 'fruit',
      tool: 'gemini.chat',
      payload: { brief, receipts, text: brief },
    });

    const fruit = { brief, receipts, payloads };
    await updateFleetRunState(pool, {
      orgId: input.orgId,
      runId: input.runId,
      status: 'completed',
      checklist,
      fruit,
      error: null,
      complete: true,
    });
    await appendFleetRunEvent(pool, {
      orgId: input.orgId,
      runId: input.runId,
      kind: 'completed',
      payload: { ok: true },
    });
    return getFleetRun(pool, input.orgId, input.runId);
  } catch (error) {
    const message = error instanceof IdentityError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'chat_run_failed';
    checklist = checklist.map((item) => (
      item.status === 'running' ? { ...item, status: 'failed' as const } : item
    ));
    await updateFleetRunState(pool, {
      orgId: input.orgId,
      runId: input.runId,
      status: 'failed',
      checklist,
      error: message,
      complete: true,
    });
    await appendFleetRunEvent(pool, {
      orgId: input.orgId,
      runId: input.runId,
      kind: 'failed',
      payload: {
        error: message,
        code: error instanceof IdentityError ? error.code : 'chat_run_failed',
        receipts_so_far: receipts,
        checklist,
      },
    });
    if (error instanceof IdentityError) throw error;
    throw new IdentityError('fleet_run_failed', 500, message);
  }
}

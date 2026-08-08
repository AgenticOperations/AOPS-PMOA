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
import type { FleetChecklistItem, FleetResolvedAgent, FleetRunRecord } from './types.js';
import { narratePlan, narrateFruit } from './gemini.js';

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
    throw new IdentityError('fleet_agents_incomplete', 409, `Fleet Run missing agent role: ${String(role)}`);
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
  let run = await getFleetRun(pool, input.orgId, input.runId);
  if (run.status === 'completed') return run;
  if (run.status === 'running') {
    throw new IdentityError('fleet_run_busy', 409, 'This Fleet Run is already executing.');
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

  try {
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
    if (dead.length > 0) {
      throw new IdentityError(
        'fleet_sellers_down',
        409,
        `Seller endpoints not reachable: ${dead.join(', ')}. Start demo sellers on :4001–4004 (KEEP_SELLERS=1) then retry.`,
      );
    }
    checklist = await setItem(pool, run, checklist, 'wire', 'done');
    await appendFleetRunEvent(pool, {
      orgId: input.orgId,
      runId: input.runId,
      kind: 'wire',
      tool: 'listing.resolve',
      payload: { live, agents: run.agents },
    });

    const mode = (await getOrgPaymentMode(pool, input.orgId)).mode;

    async function hire(stepId: string, payee: FleetResolvedAgent, chain: 'arc' | 'base') {
      checklist = await setItem(pool, run, checklist, stepId, 'running');
      await appendFleetRunEvent(pool, {
        orgId: input.orgId,
        runId: input.runId,
        kind: 'step_start',
        tool: 'agentops.payment_intra_fleet',
        payload: {
          payer: orch.name,
          payee: payee.name,
          chain,
          url: payee.endpointUrl,
        },
      });
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
    checklist = await setItem(pool, run, checklist, 'second_hop', 'done');
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
      summary: `Fleet Run ${input.runId}: ${brief.slice(0, 240)}`,
      payload: { run_id: input.runId, receipts },
    });
    checklist = await setItem(pool, run, checklist, 'activity', 'done');
    await appendFleetRunEvent(pool, {
      orgId: input.orgId,
      runId: input.runId,
      kind: 'fruit',
      tool: 'agentops.activity_record',
      payload: { brief, receipts },
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
    const message = error instanceof Error ? error.message : 'fleet_run_failed';
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
      payload: { error: message },
    });
    if (error instanceof IdentityError) throw error;
    throw new IdentityError('fleet_run_failed', 500, message);
  }
}

#!/usr/bin/env node
/**
 * validation/fleet-run-e2e.mts
 *
 * End-to-end Fleet Run against a live API + funded DEMO_ORG_ID + sellers on :4001–4004.
 *
 * Usage:
 *   DEMO_ORG_ID=org_… node --env-file=apps/api/.env --import tsx validation/fleet-run-e2e.mts
 */
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDataFetcherAgent } from '../demo/agents/data-fetcher/server.mjs';
import { createAnalystAgent } from '../demo/agents/analyst/server.mjs';
import { createWriterAgent } from '../demo/agents/writer/server.mjs';
import { createSeniorReviewerAgent } from '../demo/agents/senior-reviewer/server.mjs';

const AGENTOPS_API_BASE_URL = (process.env.AGENTOPS_API_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const DATABASE_URL = process.env.DATABASE_URL;
const ORG_ID = process.env.DEMO_ORG_ID?.trim();
const ARC_RPC_URL = process.env.ARC_RPC_URL;
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org';

if (!DATABASE_URL) throw new Error('DATABASE_URL required');
if (!ORG_ID) throw new Error('DEMO_ORG_ID required');
if (!ARC_RPC_URL) throw new Error('ARC_RPC_URL required');

function log(message: string) {
  console.log(`[fleet-run-e2e] ${message}`);
}

async function seedOperatorSession(pool: pg.Pool) {
  const userId = `usr_frun_${Date.now()}`;
  const email = `fleet-run-${Date.now()}@example.test`;
  await pool.query(
    `INSERT INTO users (id, email, name, last_seen_at) VALUES ($1, $2, 'Fleet Run E2E', now())`,
    [userId, email],
  );
  const token = `sess_${randomBytes(32).toString('base64url')}`;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await pool.query(
    `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [`ses_frun_${Date.now()}`, userId, tokenHash, new Date(Date.now() + 24 * 60 * 60 * 1000)],
  );
  await pool.query(
    `INSERT INTO memberships (id, org_id, user_id, role, status, joined_at)
     VALUES ($1, $2, $3, 'owner', 'active', now())
     ON CONFLICT DO NOTHING`,
    [`mem_frun_${Date.now()}`, ORG_ID, userId],
  );
  return token;
}

async function readWallet(pool: pg.Pool, agentId: string, chain: string) {
  const result = await pool.query(
    `SELECT address FROM agent_chain_wallets
      WHERE agent_id = $1 AND chain = $2 AND mode = 'test' AND status = 'active'
      ORDER BY created_at ASC LIMIT 1`,
    [agentId, chain],
  );
  const address = result.rows[0]?.address;
  if (typeof address !== 'string') throw new Error(`wallet_missing:${agentId}:${chain}`);
  return address;
}

async function loadFleetAgents(pool: pg.Pool) {
  const names = ['Orchestrator', 'DataFetcher', 'Analyst', 'Writer', 'SeniorReviewer'];
  const result = await pool.query(
    `SELECT DISTINCT ON (a.name) a.id, a.name
       FROM agents a
       INNER JOIN agent_chain_wallets w ON w.agent_id = a.id AND w.status = 'active'
      WHERE a.org_id = $1 AND a.name = ANY($2::text[])
        AND a.status NOT IN ('deactivated', 'retired')
      ORDER BY a.name, a.created_at DESC`,
    [ORG_ID, names],
  );
  const byName = Object.fromEntries(result.rows.map((row: { name: string; id: string }) => [row.name, row.id]));
  for (const name of names) {
    if (byName[name] === undefined) throw new Error(`fleet_agent_missing:${name}`);
  }
  return byName as Record<string, string>;
}

async function issueConnectionToken(sessionToken: string, agentId: string) {
  const response = await fetch(`${AGENTOPS_API_BASE_URL}/v1/orgs/${ORG_ID}/agents/${agentId}/connections`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${sessionToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ kind: 'agent_credential', name: `Fleet Run E2E ${Date.now()}` }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`connection_create_failed:${JSON.stringify(body)}`);
  if (typeof body.secret !== 'string') throw new Error('connection_token_missing');
  return body.secret as string;
}

async function api(sessionToken: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${AGENTOPS_API_BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${sessionToken}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text.length > 0 ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  }
  return parsed;
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  const servers: Array<{ close: () => Promise<void> }> = [];
  try {
    const health = await fetch(`${AGENTOPS_API_BASE_URL}/healthz`);
    if (!health.ok) throw new Error('api_unhealthy');
    log(`api ok · org ${ORG_ID}`);

    const agents = await loadFleetAgents(pool);
    const sessionToken = await seedOperatorSession(pool);
    const analystToken = await issueConnectionToken(sessionToken, agents.Analyst);
    // Ensure Orchestrator has a credential too (onboard / pay)
    await issueConnectionToken(sessionToken, agents.Orchestrator);

    const wallets = {
      DataFetcher: await readWallet(pool, agents.DataFetcher, 'arc'),
      Analyst: await readWallet(pool, agents.Analyst, 'arc'),
      Writer: await readWallet(pool, agents.Writer, 'arc'),
      SeniorReviewer: await readWallet(pool, agents.SeniorReviewer, 'base'),
    };

    const dataFetcher = createDataFetcherAgent({ walletAddress: wallets.DataFetcher, rpcUrl: ARC_RPC_URL });
    await dataFetcher.listen({ host: '127.0.0.1', port: 4001 });
    servers.push(dataFetcher);
    const dataFetcherUrl = 'http://127.0.0.1:4001/data?q=fleet-run';

    const analyst = createAnalystAgent({
      walletAddress: wallets.Analyst,
      rpcUrl: ARC_RPC_URL,
      apiBaseUrl: AGENTOPS_API_BASE_URL,
      connectionToken: analystToken,
      dataFetcherAgentId: agents.DataFetcher,
      dataFetcherUrl,
    });
    await analyst.listen({ host: '127.0.0.1', port: 4002 });
    servers.push(analyst);

    const writer = createWriterAgent({ walletAddress: wallets.Writer, rpcUrl: ARC_RPC_URL });
    await writer.listen({ host: '127.0.0.1', port: 4003 });
    servers.push(writer);

    const reviewer = createSeniorReviewerAgent({
      walletAddress: wallets.SeniorReviewer,
      rpcUrl: BASE_SEPOLIA_RPC_URL,
    });
    await reviewer.listen({ host: '127.0.0.1', port: 4004 });
    servers.push(reviewer);
    log('sellers up on :4001–4004');

    const created = await api(sessionToken, 'POST', `/v1/orgs/${ORG_ID}/fleet-runs`, {
      goal: undefined,
    });
    const runId = created.run.id as string;
    log(`created ${runId}`);

    const executed = await api(sessionToken, 'POST', `/v1/orgs/${ORG_ID}/fleet-runs/${runId}/execute`, {});
    const run = executed.run;
    log(`status=${run.status}`);

    if (run.status !== 'completed') {
      throw new Error(`run_failed:${run.error ?? run.status}`);
    }
    const pending = (run.checklist as Array<{ id: string; status: string; required: boolean }>).filter(
      (item) => item.required && item.status !== 'done',
    );
    if (pending.length > 0) {
      throw new Error(`checklist_incomplete:${pending.map((item) => item.id).join(',')}`);
    }
    const payments = (run.events as Array<{ kind: string; payload: Record<string, unknown> }>).filter(
      (event) => event.kind === 'payment',
    );
    if (payments.length < 4) {
      throw new Error(`expected_at_least_4_payments_got_${payments.length}`);
    }
    const basePay = payments.find((event) => event.payload.chain === 'base');
    if (basePay === undefined) throw new Error('missing_base_payment');
    const secondHop = payments.find((event) => event.payload.second_hop === true);
    if (secondHop === undefined) {
      // second hop may be recorded without flag if detected from DB — require Analyst→DataFetcher receipt in fruit
      const receipts = (run.fruit?.receipts as Array<Record<string, unknown>> | undefined) ?? [];
      const hop = receipts.find((r) => r.step === 'second_hop');
      if (hop === undefined) throw new Error('missing_second_hop');
    }

    console.log(JSON.stringify({
      ok: true,
      runId,
      payments: payments.map((p) => ({
        chain: p.payload.chain,
        tx: p.payload.tx_hash,
        second_hop: p.payload.second_hop ?? false,
      })),
      briefPreview: String(run.fruit?.brief ?? '').slice(0, 200),
    }, null, 2));
  } finally {
    await Promise.all(servers.map((server) => server.close()));
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

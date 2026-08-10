#!/usr/bin/env node
/**
 * demo/start-fleet-sellers.mjs
 *
 * Boots DataFetcher / Analyst / Writer / SeniorReviewer on :4001–4004 and
 * keeps them alive for Fleet Run / Hire desk / Chat. Ctrl+C to stop.
 *
 * Org selection (sellers bind ONE org's wallets to the ports):
 *   1. DEMO_ORG_ID or AGENTOPS_ORG_ID if set
 *   2. else auto-pick the newest org that already has all five fleet agents + wallets
 *
 * Chat itself always uses the org from your console session — it does NOT read
 * DEMO_ORG_ID. DEMO_ORG_ID is only for this seller process.
 *
 *   node --env-file=apps/api/.env demo/start-fleet-sellers.mjs
 *
 * Stack mode (setup.sh): FLEET_SELLERS_OPTIONAL=1 keeps the process alive with a
 * warning if no fleet org is found, so api/mcp/web still run.
 */
import pg from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import { createDataFetcherAgent } from './agents/data-fetcher/server.mjs';
import { createAnalystAgent } from './agents/analyst/server.mjs';
import { createWriterAgent } from './agents/writer/server.mjs';
import { createSeniorReviewerAgent } from './agents/senior-reviewer/server.mjs';

const AGENTOPS_API_BASE_URL = (process.env.AGENTOPS_API_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const DATABASE_URL = process.env.DATABASE_URL;
const ARC_RPC_URL = process.env.ARC_RPC_URL;
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org';
const OPTIONAL = process.env.FLEET_SELLERS_OPTIONAL === '1' || process.env.FLEET_SELLERS_OPTIONAL === 'true';
const LISTEN_HOST = (process.env.FLEET_SELLERS_HOST?.trim() || '127.0.0.1');
const DATA_FETCHER_PORT = Number(process.env.DATA_FETCHER_PORT ?? '4001');
const ANALYST_PORT = Number(process.env.ANALYST_PORT ?? '4002');
const WRITER_PORT = Number(process.env.WRITER_PORT ?? '4003');
const SENIOR_REVIEWER_PORT = Number(process.env.SENIOR_REVIEWER_PORT ?? '4004');
const PUBLIC_BASE = (process.env.FLEET_SELLERS_PUBLIC_BASE?.trim() || process.env.MARKETPLACE_DEMO_HOST?.trim() || 'http://127.0.0.1').replace(/\/+$/, '');
const FLEET_NAMES = ['Orchestrator', 'DataFetcher', 'Analyst', 'Writer', 'SeniorReviewer'];
// ports = http://host:4001/data (local/docker). paths = https://tunnel.example/data (ngrok/nginx).
const URL_MODE = (() => {
  const explicit = process.env.FLEET_SELLERS_URL_MODE?.trim().toLowerCase();
  if (explicit === 'paths' || explicit === 'ports') return explicit;
  return PUBLIC_BASE.startsWith('https://') ? 'paths' : 'ports';
})();

if (!DATABASE_URL) throw new Error('DATABASE_URL required');
if (!ARC_RPC_URL) throw new Error('ARC_RPC_URL required');

function isLoopbackHost(hostname) {
  const host = (hostname ?? '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
}

/** Session + membership writes must hit the same Postgres the API reads. */
function assertApiDbAlignment() {
  let apiHost;
  let dbHost;
  try {
    apiHost = new URL(AGENTOPS_API_BASE_URL).hostname;
  } catch {
    throw new Error(`Invalid AGENTOPS_API_BASE_URL: ${AGENTOPS_API_BASE_URL}`);
  }
  try {
    dbHost = new URL(DATABASE_URL).hostname;
  } catch {
    throw new Error('Invalid DATABASE_URL');
  }
  const apiLocal = isLoopbackHost(apiHost);
  const dbLocal = isLoopbackHost(dbHost);
  if (!apiLocal && dbLocal) {
    throw new Error(
      `DATABASE_URL points at ${dbHost} but AGENTOPS_API_BASE_URL is ${AGENTOPS_API_BASE_URL}. `
        + 'Seeded sessions live in local Postgres; production API cannot see them '
        + '("Operator context is required"). Set DATABASE_URL to the same Postgres Railway uses, then re-run.',
    );
  }
  if (apiLocal && !dbLocal) {
    log(`warning: local API (${apiHost}) with remote DB (${dbHost}) — unusual for tunnel mode`);
  }
  let publicHost;
  try {
    publicHost = new URL(PUBLIC_BASE).hostname;
  } catch {
    publicHost = '';
  }
  if (!apiLocal && isLoopbackHost(publicHost)) {
    throw new Error(
      `FLEET_SELLERS_PUBLIC_BASE/MARKETPLACE_DEMO_HOST is ${PUBLIC_BASE} but the API is remote (${AGENTOPS_API_BASE_URL}). `
        + 'Railway cannot reach 127.0.0.1 on your laptop — Chat falls back to catalog fixtures. '
        + 'Run `ngrok http 8088` and restart with FLEET_SELLERS_PUBLIC_BASE=https://YOUR.ngrok-free.app',
    );
  }
}

function log(message) {
  console.log(`[start-fleet-sellers] ${message}`);
}

function sellerPublicUrl(port, path) {
  if (URL_MODE === 'paths') return `${PUBLIC_BASE}${path}`;
  return `${PUBLIC_BASE}:${port}${path}`;
}

/**
 * Prefer explicit env; otherwise the newest org that already has the full
 * five-agent fleet with active wallets (so Chat in that org can settle live).
 */
async function resolveOrgId(pool) {
  const configured = process.env.DEMO_ORG_ID?.trim() || process.env.AGENTOPS_ORG_ID?.trim();
  if (configured) {
    log(`using configured org ${configured}`);
    return configured;
  }

  const result = await pool.query(
    `SELECT o.id, o.slug
       FROM orgs o
      WHERE (
        SELECT COUNT(DISTINCT a.name)
          FROM agents a
          INNER JOIN agent_chain_wallets w ON w.agent_id = a.id AND w.status = 'active'
         WHERE a.org_id = o.id
           AND a.name = ANY($1::text[])
           AND a.status NOT IN ('deactivated', 'retired')
      ) = $2
      ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC
      LIMIT 1`,
    [FLEET_NAMES, FLEET_NAMES.length],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(
      'No org has the full fleet (Orchestrator, DataFetcher, Analyst, Writer, SeniorReviewer) with wallets. Create them in Agents (any org), then restart sellers — or set DEMO_ORG_ID.',
    );
  }
  log(`auto-picked org ${row.id} (slug=${row.slug}) — Chat in this workspace will settle live`);
  return row.id;
}

async function publishFleetEndpoints(pool, orgId, agents) {
  const endpoints = [
    { agentId: agents.DataFetcher, url: sellerPublicUrl(DATA_FETCHER_PORT, '/data') },
    { agentId: agents.Analyst, url: sellerPublicUrl(ANALYST_PORT, '/analysis') },
    { agentId: agents.Writer, url: sellerPublicUrl(WRITER_PORT, '/report') },
    { agentId: agents.SeniorReviewer, url: sellerPublicUrl(SENIOR_REVIEWER_PORT, '/review') },
  ];
  for (const row of endpoints) {
    await pool.query(
      `UPDATE agents
          SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('public_endpoint_url', $2::text),
              updated_at = now()
        WHERE id = $1 AND org_id = $3`,
      [row.agentId, row.url, orgId],
    );
    log(`published ${row.url}`);
  }
}

async function idleForever(reason) {
  log(reason);
  log('Idle (optional). Create the five fleet agents in any org (or set DEMO_ORG_ID) and restart.');
  await new Promise(() => {});
}

async function loadFleetAgents(pool, orgId) {
  const result = await pool.query(
    `SELECT DISTINCT ON (a.name) a.id, a.name
       FROM agents a
       INNER JOIN agent_chain_wallets w ON w.agent_id = a.id AND w.status = 'active'
      WHERE a.org_id = $1 AND a.name = ANY($2::text[])
        AND a.status NOT IN ('deactivated', 'retired')
      ORDER BY a.name, a.created_at DESC`,
    [orgId, FLEET_NAMES],
  );
  const byName = Object.fromEntries(result.rows.map((row) => [row.name, row.id]));
  for (const name of FLEET_NAMES) {
    if (byName[name] === undefined) throw new Error(`fleet_agent_missing:${name}`);
  }
  return byName;
}

async function readWallet(pool, agentId, chain) {
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

async function seedOperatorSession(pool, orgId) {
  const existing = process.env.AGENTOPS_SESSION_TOKEN?.trim();
  if (existing) {
    log('using AGENTOPS_SESSION_TOKEN (skipping local session seed)');
    return existing;
  }

  const userId = `usr_sellers_${Date.now()}`;
  await pool.query(
    `INSERT INTO users (id, email, name, last_seen_at) VALUES ($1, $2, 'Seller Boot', now())`,
    [userId, `sellers-${Date.now()}@example.test`],
  );
  const token = `sess_${randomBytes(32).toString('base64url')}`;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await pool.query(
    `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [`ses_sellers_${Date.now()}`, userId, tokenHash, new Date(Date.now() + 24 * 60 * 60 * 1000)],
  );
  await pool.query(
    `INSERT INTO memberships (id, org_id, user_id, role, status, joined_at)
     VALUES ($1, $2, $3, 'owner', 'active', now())
     ON CONFLICT DO NOTHING`,
    [`mem_sellers_${Date.now()}`, orgId, userId],
  );
  return token;
}

async function issueConnectionToken(sessionToken, orgId, agentId) {
  const url = `${AGENTOPS_API_BASE_URL}/v1/orgs/${orgId}/agents/${agentId}/connections`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${sessionToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ kind: 'agent_credential', name: `Fleet sellers ${Date.now()}` }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot reach AgentOps API at ${AGENTOPS_API_BASE_URL} (${detail}). `
        + 'For production tunnel mode set AGENTOPS_API_BASE_URL=https://your-production-api '
        + '(local :8080 is only valid when the API is running on this machine).',
    );
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const hint = body?.message === 'Operator context is required.'
      ? ' — usually DATABASE_URL is not the production DB (session seeded locally, API looks up remotely).'
      : '';
    throw new Error(`connection_create_failed:${JSON.stringify(body)}${hint}`);
  }
  if (typeof body.secret !== 'string') throw new Error('connection_token_missing');
  return body.secret;
}

async function main() {
  assertApiDbAlignment();
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  let orgId;
  let agents;
  try {
    orgId = await resolveOrgId(pool);
    agents = await loadFleetAgents(pool, orgId);
  } catch (error) {
    await pool.end();
    const message = error instanceof Error ? error.message : String(error);
    if (OPTIONAL) {
      await idleForever(`Fleet sellers unavailable: ${message}`);
      return;
    }
    throw error;
  }

  const sessionToken = await seedOperatorSession(pool, orgId);
  const analystToken = await issueConnectionToken(sessionToken, orgId, agents.Analyst);

  const wallets = {
    DataFetcher: await readWallet(pool, agents.DataFetcher, 'arc'),
    Analyst: await readWallet(pool, agents.Analyst, 'arc'),
    Writer: await readWallet(pool, agents.Writer, 'arc'),
    SeniorReviewer: await readWallet(pool, agents.SeniorReviewer, 'base'),
  };
  log(`org ${orgId}`);
  log(`DF=${wallets.DataFetcher} AN=${wallets.Analyst} WR=${wallets.Writer} SR=${wallets.SeniorReviewer}`);

  const dataFetcherUrl = `http://127.0.0.1:${DATA_FETCHER_PORT}/data?q=fleet-run`;
  const dataFetcher = createDataFetcherAgent({ walletAddress: wallets.DataFetcher, rpcUrl: ARC_RPC_URL });
  await dataFetcher.listen({ host: LISTEN_HOST, port: DATA_FETCHER_PORT });

  const analyst = createAnalystAgent({
    walletAddress: wallets.Analyst,
    rpcUrl: ARC_RPC_URL,
    apiBaseUrl: AGENTOPS_API_BASE_URL,
    connectionToken: analystToken,
    dataFetcherAgentId: agents.DataFetcher,
    dataFetcherUrl,
  });
  await analyst.listen({ host: LISTEN_HOST, port: ANALYST_PORT });

  const writer = createWriterAgent({ walletAddress: wallets.Writer, rpcUrl: ARC_RPC_URL });
  await writer.listen({ host: LISTEN_HOST, port: WRITER_PORT });

  const reviewer = createSeniorReviewerAgent({
    walletAddress: wallets.SeniorReviewer,
    rpcUrl: BASE_SEPOLIA_RPC_URL,
  });
  await reviewer.listen({ host: LISTEN_HOST, port: SENIOR_REVIEWER_PORT });

  await publishFleetEndpoints(pool, orgId, agents);
  await pool.end();
  log(
    `sellers live on ${LISTEN_HOST}: `
      + `:${DATA_FETCHER_PORT} DataFetcher · :${ANALYST_PORT} Analyst · `
      + `:${WRITER_PORT} Writer · :${SENIOR_REVIEWER_PORT} SeniorReviewer`,
  );
  log(`API probe base ${PUBLIC_BASE} (url mode=${URL_MODE}) — use Chat in this org for live settlement.`);

  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

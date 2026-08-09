#!/usr/bin/env node
/**
 * demo/start-fleet-sellers.mjs
 *
 * Boots DataFetcher / Analyst / Writer / SeniorReviewer on :4001–4004 and
 * keeps them alive for Fleet Run / Hire desk. Ctrl+C to stop.
 *
 *   DEMO_ORG_ID=org_… node --env-file=apps/api/.env demo/start-fleet-sellers.mjs
 */
import pg from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import { createDataFetcherAgent } from './agents/data-fetcher/server.mjs';
import { createAnalystAgent } from './agents/analyst/server.mjs';
import { createWriterAgent } from './agents/writer/server.mjs';
import { createSeniorReviewerAgent } from './agents/senior-reviewer/server.mjs';

const AGENTOPS_API_BASE_URL = (process.env.AGENTOPS_API_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const DATABASE_URL = process.env.DATABASE_URL;
const ORG_ID = process.env.DEMO_ORG_ID?.trim() || 'org_9add7cd3-03eb-471f-85db-7024a9a0a5bd';
const ARC_RPC_URL = process.env.ARC_RPC_URL;
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org';

if (!DATABASE_URL) throw new Error('DATABASE_URL required');
if (!ARC_RPC_URL) throw new Error('ARC_RPC_URL required');

function log(message) {
  console.log(`[start-fleet-sellers] ${message}`);
}

async function loadFleetAgents(pool) {
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
  const byName = Object.fromEntries(result.rows.map((row) => [row.name, row.id]));
  for (const name of names) {
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

async function seedOperatorSession(pool) {
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
    [`mem_sellers_${Date.now()}`, ORG_ID, userId],
  );
  return token;
}

async function issueConnectionToken(sessionToken, agentId) {
  const response = await fetch(`${AGENTOPS_API_BASE_URL}/v1/orgs/${ORG_ID}/agents/${agentId}/connections`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${sessionToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ kind: 'agent_credential', name: `Fleet sellers ${Date.now()}` }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`connection_create_failed:${JSON.stringify(body)}`);
  if (typeof body.secret !== 'string') throw new Error('connection_token_missing');
  return body.secret;
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  const agents = await loadFleetAgents(pool);
  const sessionToken = await seedOperatorSession(pool);
  const analystToken = await issueConnectionToken(sessionToken, agents.Analyst);

  const wallets = {
    DataFetcher: await readWallet(pool, agents.DataFetcher, 'arc'),
    Analyst: await readWallet(pool, agents.Analyst, 'arc'),
    Writer: await readWallet(pool, agents.Writer, 'arc'),
    SeniorReviewer: await readWallet(pool, agents.SeniorReviewer, 'base'),
  };
  log(`org ${ORG_ID}`);
  log(`DF=${wallets.DataFetcher} AN=${wallets.Analyst} WR=${wallets.Writer} SR=${wallets.SeniorReviewer}`);

  const dataFetcherUrl = 'http://127.0.0.1:4001/data?q=fleet-run';
  const dataFetcher = createDataFetcherAgent({ walletAddress: wallets.DataFetcher, rpcUrl: ARC_RPC_URL });
  await dataFetcher.listen({ host: '127.0.0.1', port: 4001 });

  const analyst = createAnalystAgent({
    walletAddress: wallets.Analyst,
    rpcUrl: ARC_RPC_URL,
    apiBaseUrl: AGENTOPS_API_BASE_URL,
    connectionToken: analystToken,
    dataFetcherAgentId: agents.DataFetcher,
    dataFetcherUrl,
  });
  await analyst.listen({ host: '127.0.0.1', port: 4002 });

  const writer = createWriterAgent({ walletAddress: wallets.Writer, rpcUrl: ARC_RPC_URL });
  await writer.listen({ host: '127.0.0.1', port: 4003 });

  const reviewer = createSeniorReviewerAgent({
    walletAddress: wallets.SeniorReviewer,
    rpcUrl: BASE_SEPOLIA_RPC_URL,
  });
  await reviewer.listen({ host: '127.0.0.1', port: 4004 });

  await pool.end();
  log('sellers live: :4001 DataFetcher · :4002 Analyst · :4003 Writer · :4004 SeniorReviewer');
  log('Leave this process running. Retry Fleet Run in the console.');

  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

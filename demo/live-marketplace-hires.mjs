// demo/live-marketplace-hires.mjs
//
// Starts fleet seller HTTP endpoints and runs REAL on-chain marketplace
// hires (Permit2 intra-fleet / x402) so marketplace charts show navigable
// explorer txs — not seeded dummy rows.
//
// Prerequisites:
//   - API + circle-worker running
//   - DEMO_ORG_ID funded (same as demo/run.mjs)
//   - ARC_RPC_URL / BASE_SEPOLIA_RPC_URL set
//
// Usage:
//   DEMO_ORG_ID=org_… node --env-file=apps/api/.env demo/live-marketplace-hires.mjs
//
// Env:
//   HIRES_PER_LISTING=2     real payments per hireable listing (default 2)
//   INCLUDE_WEATHER=1       also hire Base weather fixtures (x402)
//   KEEP_SELLERS=0          leave seller ports up after run (default 0 = stop)

import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDataFetcherAgent } from './agents/data-fetcher/server.mjs';
import { createAnalystAgent } from './agents/analyst/server.mjs';
import { createWriterAgent } from './agents/writer/server.mjs';
import { createSeniorReviewerAgent } from './agents/senior-reviewer/server.mjs';

const AGENTOPS_API_BASE_URL = (process.env.AGENTOPS_API_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const DATABASE_URL = process.env.DATABASE_URL;
if (DATABASE_URL === undefined) throw new Error('DATABASE_URL is required');
const ORG_ID = process.env.DEMO_ORG_ID?.trim();
if (ORG_ID === undefined || ORG_ID.length === 0) throw new Error('DEMO_ORG_ID is required');
const ARC_RPC_URL = process.env.ARC_RPC_URL;
if (ARC_RPC_URL === undefined) throw new Error('ARC_RPC_URL is required');
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org';

const HIRES_PER_LISTING = Math.min(5, Math.max(1, Number.parseInt(process.env.HIRES_PER_LISTING ?? '2', 10) || 2));
const INCLUDE_WEATHER = (process.env.INCLUDE_WEATHER ?? '0') === '1';
const KEEP_SELLERS = (process.env.KEEP_SELLERS ?? '0') === '1';

function log(message) {
  console.log(`[demo/live-marketplace-hires] ${message}`);
}

async function seedOperatorSession(pool) {
  const userId = `usr_live_${Date.now()}`;
  const email = `live-hires-${Date.now()}@example.test`;
  await pool.query(
    `INSERT INTO users (id, email, name, last_seen_at) VALUES ($1, $2, 'Live Hires Operator', now())`,
    [userId, email],
  );
  const token = `sess_${randomBytes(32).toString('base64url')}`;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const sessionId = `ses_live_${Date.now()}`;
  await pool.query(
    `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, userId, tokenHash, new Date(Date.now() + 24 * 60 * 60 * 1000)],
  );
  await pool.query(
    `INSERT INTO memberships (id, org_id, user_id, role, status, joined_at)
     VALUES ($1, $2, $3, 'owner', 'active', now())
     ON CONFLICT DO NOTHING`,
    [`mem_live_${Date.now()}`, ORG_ID, userId],
  );
  return token;
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

async function loadFleetAgents(pool) {
  const names = ['Orchestrator', 'DataFetcher', 'Analyst', 'Writer', 'SeniorReviewer'];
  const result = await pool.query(
    `SELECT id, name FROM agents
      WHERE org_id = $1 AND name = ANY($2::text[])
        AND status NOT IN ('deactivated', 'retired')`,
    [ORG_ID, names],
  );
  const byName = Object.fromEntries(result.rows.map((row) => [row.name, row.id]));
  for (const name of names) {
    if (byName[name] === undefined) throw new Error(`fleet_agent_missing:${name}`);
  }
  return byName;
}

async function issueConnectionToken(_pool, sessionToken, agentId) {
  const response = await fetch(`${AGENTOPS_API_BASE_URL}/v1/orgs/${ORG_ID}/agents/${agentId}/connections`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${sessionToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ kind: 'agent_credential', name: `Live hires ${Date.now()}` }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`connection_create_failed:${body?.error ?? response.status}`);
  }
  if (typeof body.secret !== 'string') throw new Error('connection_token_missing');
  return body.secret;
}

async function apiHire(sessionToken, payerAgentId, listingId) {
  const response = await fetch(`${AGENTOPS_API_BASE_URL}/v1/orgs/${ORG_ID}/marketplace/hire/x402`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${sessionToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      client_agent_id: payerAgentId,
      listing_id: listingId,
      idempotency_key: `live-hire-${listingId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      method: 'GET',
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = body?.error ?? body?.message ?? `http_${response.status}`;
    throw new Error(String(reason));
  }
  return body;
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  const servers = [];
  const outcomes = [];

  try {
    const agents = await loadFleetAgents(pool);
    const wallets = {
      DataFetcher: await readWallet(pool, agents.DataFetcher, 'arc'),
      Analyst: await readWallet(pool, agents.Analyst, 'arc'),
      Writer: await readWallet(pool, agents.Writer, 'arc'),
      SeniorReviewer: await readWallet(pool, agents.SeniorReviewer, 'base'),
    };
    log(`org ${ORG_ID}`);
    log(`wallets DF=${wallets.DataFetcher} AN=${wallets.Analyst} WR=${wallets.Writer} SR=${wallets.SeniorReviewer}`);

    const sessionToken = await seedOperatorSession(pool);
    log('operator session ready');
    const analystToken = await issueConnectionToken(pool, sessionToken, agents.Analyst);
    log('Analyst connection token issued for second-hop');

    const dataFetcher = createDataFetcherAgent({ walletAddress: wallets.DataFetcher, rpcUrl: ARC_RPC_URL });
    await dataFetcher.listen({ host: '127.0.0.1', port: 4001 });
    servers.push(dataFetcher);
    log('DataFetcher seller on :4001');

    const analyst = createAnalystAgent({
      walletAddress: wallets.Analyst,
      rpcUrl: ARC_RPC_URL,
      apiBaseUrl: AGENTOPS_API_BASE_URL,
      connectionToken: analystToken,
      dataFetcherAgentId: agents.DataFetcher,
      dataFetcherUrl: 'http://127.0.0.1:4001/data',
    });
    await analyst.listen({ host: '127.0.0.1', port: 4002 });
    servers.push(analyst);
    log('Analyst seller on :4002');

    const writer = createWriterAgent({ walletAddress: wallets.Writer, rpcUrl: ARC_RPC_URL });
    await writer.listen({ host: '127.0.0.1', port: 4003 });
    servers.push(writer);
    log('Writer seller on :4003');

    const senior = createSeniorReviewerAgent({
      walletAddress: wallets.SeniorReviewer,
      rpcUrl: BASE_SEPOLIA_RPC_URL,
    });
    await senior.listen({ host: '127.0.0.1', port: 4004 });
    servers.push(senior);
    log('SeniorReviewer seller on :4004');

    const listingsResponse = await fetch(`${AGENTOPS_API_BASE_URL}/v1/marketplace/listings`);
    const listingsBody = await listingsResponse.json();
    if (!listingsResponse.ok) throw new Error(`listings_failed:${listingsResponse.status}`);
    const listings = listingsBody.listings ?? [];

    const hireTargets = listings.filter((listing) => {
      if (listing.providerAddress === null) return false;
      if (listing.agentId === agents.Orchestrator) return false;
      const isFleet = ['DataFetcher', 'Analyst', 'Writer', 'SeniorReviewer'].includes(listing.name)
        && (listing.kind === 'agent' || listing.id.startsWith('svc_demo_'));
      if (isFleet) return listing.kind === 'agent' || listing.id.startsWith('svc_demo_');
      if (INCLUDE_WEATHER && listing.id.startsWith('svc_testnet_weather')) return true;
      return false;
    });

    // Prefer agent_* listings over duplicate svc_demo_* for the same name to avoid double-paying.
    const byName = new Map();
    for (const listing of hireTargets) {
      const existing = byName.get(listing.name);
      if (existing === undefined) {
        byName.set(listing.name, listing);
        continue;
      }
      if (listing.kind === 'agent' && existing.kind !== 'agent') {
        byName.set(listing.name, listing);
      }
    }
    const targets = [...byName.values()];
    log(`hire targets (${targets.length}): ${targets.map((row) => row.name).join(', ')}`);

    for (const listing of targets) {
      for (let i = 0; i < HIRES_PER_LISTING; i += 1) {
        try {
          const result = await apiHire(sessionToken, agents.Orchestrator, listing.id);
          const txHash = result.payment?.txHash ?? result.payment?.tx_hash ?? null;
          log(`OK ${listing.name} #${i + 1} lane=${result.lane} tx=${txHash}`);
          outcomes.push({ listingId: listing.id, name: listing.name, ok: true, lane: result.lane, txHash });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          log(`FAIL ${listing.name} #${i + 1}: ${reason}`);
          outcomes.push({ listingId: listing.id, name: listing.name, ok: false, reason });
        }
      }
    }

    console.log(JSON.stringify({
      ok: true,
      orgId: ORG_ID,
      hiresOk: outcomes.filter((row) => row.ok).length,
      hiresFailed: outcomes.filter((row) => !row.ok).length,
      outcomes,
    }, null, 2));
  } finally {
    await pool.end();
    if (!KEEP_SELLERS) {
      await Promise.all(servers.map((server) => server.close()));
      log('sellers stopped');
    } else {
      log('KEEP_SELLERS=1 — leaving :4001–4004 running');
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

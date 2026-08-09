// Real Permit2 hires against production API.
// Sellers run locally; each is exposed via localtunnel so Railway can fetch 402.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDataFetcherAgent } from './agents/data-fetcher/server.mjs';
import { createAnalystAgent } from './agents/analyst/server.mjs';
import { createWriterAgent } from './agents/writer/server.mjs';

const AGENTOPS_API_BASE_URL = (process.env.AGENTOPS_API_BASE_URL ?? '').replace(/\/+$/, '');
const DATABASE_URL = process.env.DATABASE_URL;
const ORG_ID = process.env.DEMO_ORG_ID;
const ARC_RPC_URL = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';
if (!AGENTOPS_API_BASE_URL || !DATABASE_URL || !ORG_ID) {
  throw new Error('AGENTOPS_API_BASE_URL, DATABASE_URL, DEMO_ORG_ID required');
}

const AGENTS = {
  Orchestrator: 'agt_944bac40-5698-42a7-b985-bf399a94c881',
  DataFetcher: 'agt_e42d4860-95d4-4115-ad29-f239d1957d15',
  Analyst: 'agt_f3758da4-5827-4200-bd45-8a97d9c468bc',
  Writer: 'agt_c64b2f3a-6d78-48cd-8b0b-87d4c2dbd048',
};

const HIRES = 2;

function log(m) {
  console.log(`[prod-hires] ${m}`);
}

async function seedSession(pool) {
  const userId = `usr_hire_${Date.now()}`;
  await pool.query(
    `INSERT INTO users (id, email, name, last_seen_at) VALUES ($1, $2, 'Prod Hires', now())`,
    [userId, `prod-hire-${Date.now()}@example.test`],
  );
  const token = `sess_${randomBytes(32).toString('base64url')}`;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await pool.query(
    `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [`ses_hire_${Date.now()}`, userId, tokenHash, new Date(Date.now() + 86400000)],
  );
  await pool.query(
    `INSERT INTO memberships (id, org_id, user_id, role, status, joined_at)
     VALUES ($1, $2, $3, 'owner', 'active', now()) ON CONFLICT DO NOTHING`,
    [`mem_hire_${Date.now()}`, ORG_ID, userId],
  );
  return token;
}

async function readWallet(pool, agentId, chain) {
  const r = await pool.query(
    `SELECT address FROM agent_chain_wallets
      WHERE agent_id = $1 AND chain = $2 AND mode = 'test' AND status = 'active'
      ORDER BY created_at ASC LIMIT 1`,
    [agentId, chain],
  );
  if (typeof r.rows[0]?.address !== 'string') throw new Error(`wallet_missing:${agentId}:${chain}`);
  return r.rows[0].address;
}

async function issueConnection(sessionToken, agentId) {
  const res = await fetch(`${AGENTOPS_API_BASE_URL}/v1/orgs/${ORG_ID}/agents/${agentId}/connections`, {
    method: 'POST',
    headers: { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'agent_credential', name: `prod-hire-${Date.now()}` }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`connection_failed:${JSON.stringify(body)}`);
  return body.secret;
}

function openTunnel(port) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['--yes', 'localtunnel', '--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error(`tunnel_timeout:${port}`)), 60_000);
    const onData = (buf) => {
      const text = buf.toString();
      process.stderr.write(`[lt:${port}] ${text}`);
      const match = text.match(/https:\/\/[a-z0-9-]+\.loca\.lt/i)
        ?? text.match(/https:\/\/[^\s]+/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ url: match[0].replace(/\/$/, ''), child });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', fail);
    child.on('exit', (code) => {
      if (!settled) fail(new Error(`tunnel_exit:${port}:${code}`));
    });
  });
}

async function payIntraFleet(orchToken, payeeAgentId, url) {
  const res = await fetch(`${AGENTOPS_API_BASE_URL}/v1/runtime/payments/intra-fleet`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${orchToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      payee_agent_id: payeeAgentId,
      chain: 'arc',
      url,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`hire_failed:${res.status}:${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });
  const servers = [];
  const tunnels = [];
  try {
    const wallets = {
      DataFetcher: await readWallet(pool, AGENTS.DataFetcher, 'arc'),
      Analyst: await readWallet(pool, AGENTS.Analyst, 'arc'),
      Writer: await readWallet(pool, AGENTS.Writer, 'arc'),
    };
    log(`wallets DF=${wallets.DataFetcher} AN=${wallets.Analyst} WR=${wallets.Writer}`);

    const session = await seedSession(pool);
    const orchToken = await issueConnection(session, AGENTS.Orchestrator);
    const analystToken = await issueConnection(session, AGENTS.Analyst);
    log('connection tokens issued');

    const df = createDataFetcherAgent({ walletAddress: wallets.DataFetcher, rpcUrl: ARC_RPC_URL });
    await df.listen({ host: '0.0.0.0', port: 4001 });
    servers.push(df);
    const an = createAnalystAgent({
      walletAddress: wallets.Analyst,
      rpcUrl: ARC_RPC_URL,
      apiBaseUrl: AGENTOPS_API_BASE_URL,
      connectionToken: analystToken,
      dataFetcherAgentId: AGENTS.DataFetcher,
      dataFetcherUrl: 'http://127.0.0.1:4001/data',
    });
    await an.listen({ host: '0.0.0.0', port: 4002 });
    servers.push(an);
    const wr = createWriterAgent({ walletAddress: wallets.Writer, rpcUrl: ARC_RPC_URL });
    await wr.listen({ host: '0.0.0.0', port: 4003 });
    servers.push(wr);
    log('sellers listening 4001-4003');

    const dfTunnel = await openTunnel(4001);
    tunnels.push(dfTunnel);
    const anTunnel = await openTunnel(4002);
    tunnels.push(anTunnel);
    const wrTunnel = await openTunnel(4003);
    tunnels.push(wrTunnel);
    log(`tunnels DF=${dfTunnel.url} AN=${anTunnel.url} WR=${wrTunnel.url}`);

    // Update public endpoints to tunnel URLs for future hire/demo.
    await pool.query(
      `UPDATE agents SET metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('public_endpoint_url', $2::text)
        WHERE id = $1`,
      [AGENTS.DataFetcher, `${dfTunnel.url}/data`],
    );
    await pool.query(
      `UPDATE agents SET metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('public_endpoint_url', $2::text)
        WHERE id = $1`,
      [AGENTS.Analyst, `${anTunnel.url}/analysis`],
    );
    await pool.query(
      `UPDATE agents SET metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('public_endpoint_url', $2::text)
        WHERE id = $1`,
      [AGENTS.Writer, `${wrTunnel.url}/report`],
    );

    const targets = [
      { name: 'DataFetcher', id: AGENTS.DataFetcher, url: `${dfTunnel.url}/data` },
      { name: 'Analyst', id: AGENTS.Analyst, url: `${anTunnel.url}/analysis` },
      { name: 'Writer', id: AGENTS.Writer, url: `${wrTunnel.url}/report` },
    ];

    for (const target of targets) {
      for (let i = 0; i < HIRES; i += 1) {
        try {
          const result = await payIntraFleet(orchToken, target.id, target.url);
          const tx = result?.payment?.txHash ?? result?.txHash ?? '?';
          log(`OK ${target.name} #${i + 1} tx=${tx}`);
        } catch (err) {
          log(`FAIL ${target.name} #${i + 1}: ${err.message}`);
        }
      }
    }

    // Second hop: Analyst pays DataFetcher
    try {
      const result = await payIntraFleet(analystToken, AGENTS.DataFetcher, `${dfTunnel.url}/data`);
      log(`OK Analyst→DataFetcher tx=${result?.payment?.txHash ?? result?.txHash ?? '?'}`);
    } catch (err) {
      log(`FAIL Analyst→DataFetcher: ${err.message}`);
    }
  } finally {
    for (const t of tunnels) {
      try { t.child.kill(); } catch { /* ignore */ }
    }
    for (const s of servers) {
      try { await s.close(); } catch { /* ignore */ }
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

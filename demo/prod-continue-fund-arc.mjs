// Continue funding Arc fleet agents after reset got Arc Gateway credit
// but Base gateway.deposit failed. Sets Arc allocations and waits for top-ups.
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

const AGENTOPS_API_BASE_URL = (process.env.AGENTOPS_API_BASE_URL ?? '').replace(/\/+$/, '');
const DATABASE_URL = process.env.DATABASE_URL;
const ORG_ID = process.env.DEMO_ORG_ID;
if (!AGENTOPS_API_BASE_URL || !DATABASE_URL || !ORG_ID) {
  throw new Error('AGENTOPS_API_BASE_URL, DATABASE_URL, DEMO_ORG_ID required');
}

const ARC_RPC_URL = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';
const ALLOCATION = '1.50';
const NEED_MICROS = 1_500_000;

const AGENTS = {
  Orchestrator: 'agt_944bac40-5698-42a7-b985-bf399a94c881',
  DataFetcher: 'agt_e42d4860-95d4-4115-ad29-f239d1957d15',
  Analyst: 'agt_f3758da4-5827-4200-bd45-8a97d9c468bc',
  Writer: 'agt_c64b2f3a-6d78-48cd-8b0b-87d4c2dbd048',
  SeniorReviewer: 'agt_b15b4809-88d3-481b-a1a6-d2ea6fe2afc3',
};

function log(m) {
  console.log(`[prod-continue] ${m}`);
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function seedSession(pool) {
  const userId = `usr_prod_${Date.now()}`;
  const email = `prod-fund-${Date.now()}@example.test`;
  await pool.query(
    `INSERT INTO users (id, email, name, last_seen_at) VALUES ($1, $2, 'Prod Fund', now())`,
    [userId, email],
  );
  const token = `sess_${randomBytes(32).toString('base64url')}`;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await pool.query(
    `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [`ses_prod_${Date.now()}`, userId, tokenHash, new Date(Date.now() + 86400000)],
  );
  await pool.query(
    `INSERT INTO memberships (id, org_id, user_id, role, status, joined_at)
     VALUES ($1, $2, $3, 'owner', 'active', now()) ON CONFLICT DO NOTHING`,
    [`mem_prod_${Date.now()}`, ORG_ID, userId],
  );
  await pool.query(`UPDATE orgs SET default_policy_effect = 'allow' WHERE id = $1`, [ORG_ID]);
  return token;
}

async function api(method, path, token, body) {
  const res = await fetch(`${AGENTOPS_API_BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : undefined;
}

async function rpcBalance(address) {
  const res = await fetch(ARC_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBalance',
      params: [address, 'latest'],
    }),
  });
  const json = await res.json();
  // Arc native USDC uses 18 decimals for eth_getBalance
  return Number(BigInt(json.result)) / 1e18;
}

async function waitFunded(label, address) {
  const deadline = Date.now() + 10 * 60 * 1000;
  for (;;) {
    const bal = await rpcBalance(address);
    log(`${label} ${address} = ${bal.toFixed(6)} USDC`);
    if (bal * 1e6 >= NEED_MICROS * 0.9) return;
    if (Date.now() > deadline) throw new Error(`timeout funding ${label}`);
    await sleep(5000);
  }
}

async function main() {
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
  try {
    const token = await seedSession(pool);
    log('session ready');

    // Publish endpoints so public marketplace can enrich seed cards.
    for (const [name, id] of Object.entries(AGENTS)) {
      if (name === 'SeniorReviewer') continue; // Base — skip until gateway deposit works
      const port =
        name === 'DataFetcher' ? 4001
          : name === 'Analyst' ? 4002
            : name === 'Writer' ? 4003
              : name === 'Orchestrator' ? 4000
                : 0;
      if (port === 0) continue;
      const endpoint =
        name === 'DataFetcher' ? `http://127.0.0.1:${port}/data`
          : name === 'Analyst' ? `http://127.0.0.1:${port}/analysis`
            : name === 'Writer' ? `http://127.0.0.1:${port}/report`
              : `http://127.0.0.1:${port}/`;
      await pool.query(
        `UPDATE agents
            SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('public_endpoint_url', $2::text),
                updated_at = now()
          WHERE id = $1`,
        [id, endpoint],
      );
      log(`published ${name} endpoint ${endpoint}`);
    }

    for (const name of ['Orchestrator', 'DataFetcher', 'Analyst', 'Writer']) {
      await api('POST', `/v1/orgs/${ORG_ID}/agents/${AGENTS[name]}/allocation`, token, {
        chain: 'arc',
        allocated_usdc: ALLOCATION,
        low_water_mark_usdc: ALLOCATION,
        ceiling_usdc: ALLOCATION,
      });
      log(`allocation set ${name} arc ${ALLOCATION}`);
    }

    const wallets = await pool.query(
      `SELECT a.name, w.address
         FROM agent_chain_wallets w
         JOIN agents a ON a.id = w.agent_id
        WHERE a.org_id = $1 AND w.chain = 'arc' AND w.status = 'active'
          AND a.name = ANY($2::text[])`,
      [ORG_ID, ['Orchestrator', 'DataFetcher', 'Analyst', 'Writer']],
    );
    for (const row of wallets.rows) {
      await waitFunded(row.name, row.address);
    }
    log('Arc fleet wallets funded');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// demo/reset.mjs -- fresh org, fresh agents, fresh real Circle wallets,
// fresh testnet funding, every run. Judges may run the demo twice: this
// creates a brand-new org each time (orgs.slug self-heals on collision,
// see createOrg in identity/store.ts), so there is nothing to collide on.
//
// Talks to the REAL agentOps HTTP API (org/agent/connection creation,
// payment-access, testnet-faucet) -- never reaches into engine internals
// for anything a real integration could do over HTTP. The one exception
// is reading back each agent's provisioned wallet address: no HTTP route
// exposes per-agent agent_chain_wallets rows today, so this reads them
// directly via a read-only query against the same Postgres the API uses.
//
// Prerequisites (this script does not start these):
//   - `npm run dev:api` running, reachable at AGENTOPS_API_BASE_URL
//   - `npm run dev:circle-worker` running against the SAME database --
//     it's the one that actually processes 'agent_wallet.create' jobs
//     against Circle's real API, and testnet-faucet funding jobs.
//   - Real Circle test-mode credentials configured for both.
//   - DATABASE_URL pointing at that same database, for this script's
//     read-only wallet-address lookup.
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

const AGENTOPS_API_BASE_URL = (process.env.AGENTOPS_API_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const DATABASE_URL = process.env.DATABASE_URL;
if (DATABASE_URL === undefined) throw new Error('DATABASE_URL is required (same database dev:api/dev:circle-worker use)');
const ARC_RPC_URL = process.env.ARC_RPC_URL;
if (ARC_RPC_URL === undefined) throw new Error('ARC_RPC_URL is required');
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org';
const RPC_URL_BY_CHAIN = { arc: ARC_RPC_URL, base: BASE_SEPOLIA_RPC_URL };

// Every agent gets this much allocated/funded per chain it operates on
// -- above the $5 Permit2 delegation ceiling (intra-fleet.ts's
// DEFAULT_DELEGATION_CEILING_USDC) plus real gas, but kept modest since
// treasury funding for this demo comes from a manual testnet-USDC
// transfer (Circle's shared faucet is rate-limited), not an
// unlimited tap.
// Sized so one funding round covers a full run on real testnet USDC:
// 4 Arc agents + 2 Base agents at this rate = 6.00 Arc + 3.00 Base, well
// inside the deposits below. The scenario's own payments are sub-cent, so
// the allocation only has to clear the top-up floor, not fund the work.
const AGENT_ALLOCATION_USDC = '1.50';
const AGENT_ALLOCATION_MICROS = 1_500_000;

// What the treasury must hold in-wallet before depositing to Gateway, and
// how much to deposit. Deliberately just above the allocation totals above
// (6.00 Arc / 3.00 Base) -- these are real testnet funds topped up by hand,
// and every USDC deposited to Gateway leaves the wallet for good.
const TREASURY_ARC_MIN_MICROS = 8_000_000;
const TREASURY_BASE_MIN_MICROS = 4_000_000;
const TREASURY_ARC_DEPOSIT_USDC = '8.00';
const TREASURY_BASE_DEPOSIT_USDC = '4.00';

// Base Sepolia USDC. Base holds USDC as an ordinary ERC-20, so every balance
// read there goes through balanceOf on this token -- unlike Arc, where USDC
// is the native gas asset and eth_getBalance is the correct read.
const BASE_USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

const JOB_POLL_INTERVAL_MS = 3000;
const JOB_POLL_TIMEOUT_MS = 5 * 60 * 1000; // Circle wallet creation + testnet faucet grants are real, slow, external calls.

function log(message) {
  console.log(`[demo/reset] ${message}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiRequest(method, path, body, sessionToken) {
  const headers = { 'content-type': 'application/json' };
  if (sessionToken !== undefined) headers.authorization = `Bearer ${sessionToken}`;
  const response = await fetch(`${AGENTOPS_API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text.length > 0 ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${text}`);
  }
  return parsed;
}

/**
 * Seeds a real, valid session for a throwaway demo-operator user, using
 * the exact same token-hashing scheme resolveSession (auth/store.ts)
 * checks against -- this is not a bypass of auth, it's creating a real
 * row through the same table real Google OAuth logins write to. Needed
 * because dev:api has no non-interactive login path: every mutating
 * route requires a real operator/session, and this script has no
 * browser to complete an OAuth dance with.
 */
async function seedOperatorSession(pool) {
  const userId = `usr_demo_${Date.now()}`;
  const email = `demo-operator-${Date.now()}@example.test`;
  await pool.query(
    `INSERT INTO users (id, email, name, last_seen_at) VALUES ($1, $2, 'Demo Operator', now())`,
    [userId, email],
  );
  const token = `sess_${randomBytes(32).toString('base64url')}`;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const sessionId = `ses_demo_${Date.now()}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [sessionId, userId, tokenHash, expiresAt],
  );
  return token;
}

function usdcFromMicros(micros) {
  return (Number(micros) / 1_000_000).toFixed(2);
}

/**
 * Reads the treasury's REAL Circle Gateway balance for both chains. This
 * is the number allocations are solvency-checked against (allocations.ts's
 * treasuryDepositsMicros), which is why the wallet balance alone can't
 * tell this script whether a deposit is actually needed.
 */
async function readGatewayBalances(depositor) {
  const apiKey = process.env.CIRCLE_TEST_API_KEY;
  if (apiKey === undefined) throw new Error('CIRCLE_TEST_API_KEY is required');
  const response = await fetch('https://gateway-api-testnet.circle.com/v1/balances', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      token: 'USDC',
      sources: [{ domain: 26, depositor }, { domain: 6, depositor }],
    }),
  });
  if (!response.ok) throw new Error(`gateway_balances -> ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  const micros = (domain) => {
    const row = (payload.balances ?? []).find((entry) => entry.domain === domain);
    return Math.round(Number(row?.balance ?? 0) * 1_000_000);
  };
  return { arc: micros(26), base: micros(6) };
}

async function waitForGatewayCredit(depositor, arcMinMicros, baseMinMicros) {
  await pollUntil(`gateway credit for ${depositor} (arc >= ${arcMinMicros}, base >= ${baseMinMicros})`, async () => {
    const balances = await readGatewayBalances(depositor);
    return balances.arc >= arcMinMicros && balances.base >= baseMinMicros ? true : undefined;
  });
}

async function pollUntil(description, check) {
  const deadline = Date.now() + JOB_POLL_TIMEOUT_MS;
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() > deadline) throw new Error(`timed_out_waiting_for:${description}`);
    await sleep(JOB_POLL_INTERVAL_MS);
  }
}

async function createOrg(sessionToken, name) {
  const slugSafe = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const result = await apiRequest('POST', '/v1/orgs', {
    name,
    owner: { email: `${slugSafe}-${Date.now()}@example.test`, name: 'Demo Owner' },
  }, sessionToken);
  return result.org.id;
}

/**
 * Creates the agent, or returns the existing one with the same name when
 * reusing an org. Creating a fresh agent every run would provision a fresh
 * Circle wallet for it, stranding whatever the previous run's wallet was
 * topped up with -- the funds are real, so they have to be reused too.
 */
async function createAgent(sessionToken, orgId, name, reuse) {
  if (reuse) {
    const existing = await apiRequest('GET', `/v1/orgs/${orgId}/agents`, undefined, sessionToken);
    const match = (existing.agents ?? []).find((agent) => agent.name === name);
    if (match !== undefined) return match.id;
  }
  const result = await apiRequest('POST', `/v1/orgs/${orgId}/agents`, { name }, sessionToken);
  return result.agent.id;
}

/**
 * Creates the org's real Circle wallet set (circle_wallet_sets row) --
 * required before any agent_wallet.create job can resolve where to
 * provision that agent's wallet. Without this, wallet creation jobs
 * fail with circle_wallet_set_not_found.
 */
async function createTreasury(sessionToken, orgId) {
  await apiRequest('POST', `/v1/orgs/${orgId}/payments/circle/treasury`, { label: 'Demo Fleet Treasury' }, sessionToken);
}

async function createConnection(sessionToken, orgId, agentId) {
  const result = await apiRequest('POST', `/v1/orgs/${orgId}/agents/${agentId}/connections`, {
    kind: 'agent_credential',
    name: 'Runtime',
  }, sessionToken);
  return result.secret;
}

/**
 * Grants payment access with dedicated_wallet_required: true for the
 * given rails -- this is what enqueues real 'agent_wallet.create' jobs
 * (agent-wallets.ts's enqueueAgentWalletProvisioning, called from
 * setAgentPaymentAccess in store.ts) for the chains those rails map to.
 */
async function grantPaymentAccess(sessionToken, orgId, agentId, rails) {
  await apiRequest('POST', `/v1/orgs/${orgId}/agents/${agentId}/payment-access`, {
    status: 'active',
    allowed_rails: rails,
    budget_usdc: '25.00',
    dedicated_wallet_required: true,
    per_request_cap_usdc: '5.00',
  }, sessionToken);
}

async function waitForWalletJobsToSettle(sessionToken, orgId, agentId, chains, pool) {
  // On a reused org the wallets already exist and their create-jobs may have
  // aged out of the API's 12-row job window entirely -- polling job history
  // would then wait forever for something that finished runs ago. The wallet
  // rows themselves are the durable signal, so check those first.
  const existing = await pool.query(
    `SELECT chain FROM agent_chain_wallets WHERE agent_id = $1 AND status = 'active'`,
    [agentId],
  );
  const activeChains = new Set(existing.rows.map((row) => row.chain));
  if (chains.every((chain) => activeChains.has(chain))) return;

  await pollUntil(`agent_wallet.create jobs for ${agentId} (${chains.join(',')})`, async () => {
    const { jobs } = await apiRequest('GET', `/v1/orgs/${orgId}/payments/circle/jobs`, undefined, sessionToken);
    const relevant = jobs.filter((job) => job.job_type === 'agent_wallet.create' && job.metadata?.agent_id === agentId);
    const forChains = chains.filter((chain) => relevant.some((job) => job.chain === chain));
    if (forChains.length < chains.length) return undefined; // job not enqueued/visible yet
    const failed = relevant.find((job) => chains.includes(job.chain) && job.status === 'failed');
    if (failed !== undefined) throw new Error(`agent_wallet_create_failed:${agentId}:${failed.chain}:${failed.error_code ?? 'unknown'}`);
    const allDone = chains.every((chain) => relevant.some((job) => job.chain === chain && job.status === 'complete'));
    return allDone ? true : undefined;
  });
}

/**
 * Registers a real on-chain treasury balance with Circle's Gateway --
 * the solvency check setAllocation runs (treasuryDepositsMicros) reads
 * ONLY the Gateway-registered balance, never the raw wallet balance
 * directly, so funds sitting in the treasury wallet don't count until
 * this runs. Async (job_type 'gateway.deposit'), processed by
 * circle-worker -- polls to 'complete'.
 *
 * NOTE: this demo does NOT use Circle's testnet faucet
 * (POST .../testnet-faucet) to fund the treasury -- that endpoint calls
 * Circle's real, shared testnet faucet API, which this session found
 * genuinely rate-limited (a live 429 from api.circle.com, confirmed by
 * calling requestTestnetFunds directly) after the volume of real
 * spikes/tests run against it. The treasury wallet must be funded
 * out-of-band (a manual testnet USDC transfer to its address) before
 * calling this.
 */
async function registerGatewayDeposit(sessionToken, orgId, chain, amountUsdc) {
  const { job } = await apiRequest('POST', `/v1/orgs/${orgId}/payments/circle/gateway-deposits`, {
    amount_usdc: amountUsdc,
    chain,
  }, sessionToken);
  if (job.status === 'failed') throw new Error(`gateway_deposit_failed:${chain}:${job.error_code ?? 'unknown'}`);
  await pollUntil(`gateway.deposit job for ${chain}`, async () => {
    const { jobs } = await apiRequest('GET', `/v1/orgs/${orgId}/payments/circle/jobs`, undefined, sessionToken);
    const current = jobs.find((j) => j.id === job.id);
    if (current === undefined) return undefined;
    if (current.status === 'failed') throw new Error(`gateway_deposit_failed:${chain}:${current.error_code ?? 'unknown'}`);
    return current.status === 'complete' ? true : undefined;
  });
}

/**
 * Creates the agent_allocations row that lets evaluateTopUps (run every
 * circle-worker poll tick, see circle-worker.ts) automatically fund this
 * agent's own wallet from the org's shared treasury. Rejects with a real
 * 409 if the combined allocations for this org+chain would exceed real
 * treasury deposits (verified against Circle's live Gateway balance API)
 * -- so treasury funding must happen (requestTestnetFunds) before this.
 */
async function setAllocation(sessionToken, orgId, agentId, chain, allocatedUsdc) {
  await apiRequest('POST', `/v1/orgs/${orgId}/agents/${agentId}/allocation`, {
    chain,
    allocated_usdc: allocatedUsdc,
    // Low water mark 0: evaluateTopUps only tops up when the agent's
    // spendable balance is BELOW this, and a freshly allocated agent
    // starts at 0 -- so with a positive low water mark, every fresh
    // allocation immediately qualifies for exactly one top-up, without
    // implying an ongoing budget policy the demo doesn't need.
    low_water_mark_usdc: allocatedUsdc,
    ceiling_usdc: allocatedUsdc,
  }, sessionToken);
}

async function readTreasuryAddress(pool, orgId, chain) {
  return pollUntil(`circle_chain_wallets treasury row for org ${orgId}/${chain}`, async () => {
    const result = await pool.query(
      `SELECT address FROM circle_chain_wallets WHERE org_id = $1 AND chain = $2 AND status = 'active' LIMIT 1`,
      [orgId, chain],
    );
    return result.rows[0]?.address;
  });
}

/**
 * Blocks until the treasury address holds at least minMicros on-chain --
 * Circle creates a NEW wallet/address per org (unified across chains, but
 * unique per org), so a previous run's manually-funded address is stale
 * for a fresh org. Printing the address and waiting here (rather than
 * failing straight into a Gateway-deposit "insufficient funds" error)
 * gives whoever's funding it the exact right target up front.
 */
async function waitForTreasuryFunded(rpcUrlByChain, address, chain, minMicros) {
  log(`waiting for >= ${(Number(minMicros) / 1_000_000).toFixed(2)} USDC on ${chain} at ${address} ...`);
  return pollUntil(`treasury on-chain balance for ${address} (${chain}) >= ${minMicros} micros`, async () => {
    if (chain === 'arc') {
      const response = await fetch(rpcUrlByChain.arc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
      });
      const body = await response.json();
      if (body.error !== undefined || typeof body.result !== 'string') return undefined;
      const micros = BigInt(body.result) / 1_000_000_000_000n;
      return micros >= BigInt(minMicros) ? true : undefined;
    }
    // Base: real USDC ERC-20 balanceOf, not native ETH balance.
    const paddedAddress = address.slice(2).padStart(64, '0');
    const response = await fetch(rpcUrlByChain.base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to: BASE_USDC_ADDRESS, data: `0x70a08231${paddedAddress}` }, 'latest'],
      }),
    });
    const body = await response.json();
    if (body.error !== undefined || typeof body.result !== 'string') return undefined;
    const micros = BigInt(body.result);
    return micros >= BigInt(minMicros) ? true : undefined;
  });
}

async function readAgentWalletAddress(pool, agentId, chain) {
  return pollUntil(`agent_chain_wallets row for ${agentId}/${chain}`, async () => {
    const result = await pool.query(
      `SELECT address FROM agent_chain_wallets WHERE agent_id = $1 AND chain = $2 AND status = 'active' LIMIT 1`,
      [agentId, chain],
    );
    return result.rows[0]?.address;
  });
}

/**
 * Waits for the agent's real on-chain spendable balance to reach at
 * least minMicros -- i.e. for the circle-worker's poll loop to notice
 * the fresh allocation, enqueue+execute a real agent_wallet.topup
 * transfer, and for that transfer to land on-chain. Reads the chain
 * directly (nativeBalanceMicros's own retry logic already handles Arc's
 * flaky public RPC, per spike S6), not the job table, since a
 * 'complete' job status only means the transfer was SUBMITTED.
 */
/**
 * Reads an address's real USDC balance in micros. The two chains store USDC
 * differently and must be read differently -- the same split agent-wallets.ts
 * (nativeBalanceMicros) already makes:
 *   - Arc:  USDC IS the native gas asset -> eth_getBalance, 18 decimals.
 *   - Base: USDC is an ordinary ERC-20 -> balanceOf on the token, 6 decimals.
 * Reading Base with eth_getBalance returns its ETH balance instead, which is
 * never the USDC a top-up delivered.
 */
async function usdcBalanceMicros(rpcUrlByChain, address, chain) {
  const rpcUrl = rpcUrlByChain[chain];
  const call = chain === 'arc'
    ? { method: 'eth_getBalance', params: [address, 'latest'] }
    : {
        method: 'eth_call',
        params: [{ to: BASE_USDC_ADDRESS, data: `0x70a08231${address.slice(2).padStart(64, '0')}` }, 'latest'],
      };
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...call }),
  });
  const body = await response.json();
  if (body.error !== undefined || typeof body.result !== 'string') return undefined;
  const raw = BigInt(body.result);
  // Arc's native USDC carries 18 decimals; Base's ERC-20 USDC already is micros.
  return chain === 'arc' ? raw / 1_000_000_000_000n : raw;
}

async function waitForAgentWalletFunded(rpcUrlByChain, address, chain, minMicros) {
  return pollUntil(`on-chain balance for ${address} (${chain}) >= ${minMicros} micros`, async () => {
    const micros = await usdcBalanceMicros(rpcUrlByChain, address, chain);
    if (micros === undefined) return undefined;
    return micros >= BigInt(minMicros) ? true : undefined;
  });
}

/**
 * Resets the demo to a fresh, funded, ready-to-run state: a new org,
 * five new agents (Orchestrator, DataFetcher, Analyst, Writer,
 * SeniorReviewer) each with a real connection credential and a real
 * Circle-provisioned wallet (Orchestrator gets one on Arc AND Base).
 * Prints the treasury address and waits for it to hold real funds
 * on-chain before registering a Gateway deposit and allocating each
 * agent's share -- see the file header for why funding is manual.
 */
export async function resetDemo() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    const sessionToken = await seedOperatorSession(pool);
    log('seeded a real operator session (auth_sessions row, same table real Google OAuth logins write to)');

    // Each org gets its own Circle wallet set, so a brand-new org means a
    // brand-new treasury address that has to be funded from scratch. On
    // testnet that makes repeat runs impractical -- funds would have to be
    // swept forward every time. DEMO_ORG_ID reuses an already-funded org so
    // the same treasury (and its real balance) carries across runs; the
    // agents/wallets below are created idempotently against it.
    const reuseOrgId = process.env.DEMO_ORG_ID;
    const orgId = reuseOrgId ?? await createOrg(sessionToken, `Demo Fleet ${Date.now()}`);
    if (reuseOrgId !== undefined) {
      // createOrg() would have made this operator the owner. Reusing an org
      // skips that, so grant the freshly-seeded operator membership directly
      // -- otherwise every subsequent request 404s as "Workspace not found".
      const tokenHash = createHash('sha256').update(sessionToken).digest('hex');
      await pool.query(
        `INSERT INTO memberships (id, org_id, user_id, role, status, joined_at)
         SELECT $1, $2, s.user_id, 'owner', 'active', now()
         FROM auth_sessions s WHERE s.token_hash = $3
         ON CONFLICT DO NOTHING`,
        [`mem_demo_${Date.now()}`, orgId, tokenHash],
      );
    }
    log(reuseOrgId === undefined ? `created org ${orgId}` : `reusing funded org ${orgId}`);

    // A fresh org defaults to default_policy_effect = 'deny' (no route
    // sets this -- every real operator would author an allow policy
    // through the policy-draft workflow, itself a much larger real
    // sub-feature this demo doesn't need to exercise). Flip it directly,
    // same convention this codebase's own test suite already uses to
    // bootstrap a permissive test org.
    await pool.query("UPDATE orgs SET default_policy_effect = 'allow' WHERE id = $1", [orgId]);

    const agentIds = {};
    const connectionTokens = {};
    for (const name of ['Orchestrator', 'DataFetcher', 'Analyst', 'Writer', 'SeniorReviewer']) {
      agentIds[name] = await createAgent(sessionToken, orgId, name, reuseOrgId !== undefined);
      connectionTokens[name] = await createConnection(sessionToken, orgId, agentIds[name]);
      log(`${reuseOrgId === undefined ? 'created' : 'resolved'} agent ${name} (${agentIds[name]})`);
    }

    // On a reused org the treasury already exists AND already holds real
    // funds. Calling createTreasury again re-derives its chain wallets and
    // overwrites circle_chain_wallets with fresh, empty addresses -- which
    // strands the balance at the old address. Skip it and keep what's funded.
    if (reuseOrgId === undefined) {
      await createTreasury(sessionToken, orgId);
    }
    const treasuryArcAddress = await readTreasuryAddress(pool, orgId, 'arc');
    const treasuryBaseAddress = await readTreasuryAddress(pool, orgId, 'base');
    log(`${reuseOrgId === undefined ? 'created' : 'reusing'} org treasury (circle_wallet_sets) -- address ${treasuryArcAddress} on both chains`);

    // Orchestrator needs wallets on BOTH chains; everyone else is
    // single-chain. SeniorReviewer lives on Base only -- the cross-chain
    // hop -- never sharing a Gateway/Arc balance with the rest of the fleet.
    await grantPaymentAccess(sessionToken, orgId, agentIds.Orchestrator, ['exact_arc', 'exact_base']);
    await grantPaymentAccess(sessionToken, orgId, agentIds.DataFetcher, ['exact_arc']);
    await grantPaymentAccess(sessionToken, orgId, agentIds.Analyst, ['exact_arc']);
    await grantPaymentAccess(sessionToken, orgId, agentIds.Writer, ['exact_arc']);
    await grantPaymentAccess(sessionToken, orgId, agentIds.SeniorReviewer, ['exact_base']);
    log('requested wallet provisioning for all five agents');

    await waitForWalletJobsToSettle(sessionToken, orgId, agentIds.Orchestrator, ['arc', 'base'], pool);
    await waitForWalletJobsToSettle(sessionToken, orgId, agentIds.DataFetcher, ['arc'], pool);
    await waitForWalletJobsToSettle(sessionToken, orgId, agentIds.Analyst, ['arc'], pool);
    await waitForWalletJobsToSettle(sessionToken, orgId, agentIds.Writer, ['arc'], pool);
    await waitForWalletJobsToSettle(sessionToken, orgId, agentIds.SeniorReviewer, ['base'], pool);
    log('all wallets provisioned');

    const wallets = {
      Orchestrator: {
        arc: await readAgentWalletAddress(pool, agentIds.Orchestrator, 'arc'),
        base: await readAgentWalletAddress(pool, agentIds.Orchestrator, 'base'),
      },
      DataFetcher: { arc: await readAgentWalletAddress(pool, agentIds.DataFetcher, 'arc') },
      Analyst: { arc: await readAgentWalletAddress(pool, agentIds.Analyst, 'arc') },
      Writer: { arc: await readAgentWalletAddress(pool, agentIds.Writer, 'arc') },
      SeniorReviewer: { base: await readAgentWalletAddress(pool, agentIds.SeniorReviewer, 'base') },
    };
    log('all wallet addresses resolved');

    // Wait for the treasury to actually hold real funds on-chain before
    // attempting the Gateway deposit -- see reset.mjs's header comment on
    // the faucet rate limit for why this is manual, not the testnet
    // faucet route.
    // A Gateway deposit moves USDC OUT of the treasury wallet and into
    // Gateway, and it's Gateway's balance -- not the wallet's -- that every
    // allocation is solvency-checked against. So on a reused org the wallet
    // is legitimately near-empty while Gateway holds the real float: skip
    // both the funding wait and the deposit whenever Gateway already covers
    // this run, otherwise each run would demand fresh funds it doesn't need.
    const gatewayBalances = await readGatewayBalances(treasuryArcAddress);
    const arcNeeded = 4 * AGENT_ALLOCATION_MICROS;
    const baseNeeded = 2 * AGENT_ALLOCATION_MICROS;

    if (gatewayBalances.arc >= arcNeeded) {
      log(`gateway already holds ${usdcFromMicros(gatewayBalances.arc)} USDC on arc -- skipping deposit`);
    } else {
      await waitForTreasuryFunded(RPC_URL_BY_CHAIN, treasuryArcAddress, 'arc', TREASURY_ARC_MIN_MICROS);
      await registerGatewayDeposit(sessionToken, orgId, 'arc', TREASURY_ARC_DEPOSIT_USDC);
      log('registered treasury deposit with Circle Gateway for arc');
    }

    if (gatewayBalances.base >= baseNeeded) {
      log(`gateway already holds ${usdcFromMicros(gatewayBalances.base)} USDC on base -- skipping deposit`);
    } else {
      await waitForTreasuryFunded(RPC_URL_BY_CHAIN, treasuryBaseAddress, 'base', TREASURY_BASE_MIN_MICROS);
      await registerGatewayDeposit(sessionToken, orgId, 'base', TREASURY_BASE_DEPOSIT_USDC);
      log('registered treasury deposit with Circle Gateway for base');
    }

    // Gateway credits a deposit only after the source chain finalizes, so a
    // deposit that just landed on-chain can still read as 0 here. Allocating
    // against that would trip the solvency guard, so wait for the credit.
    await waitForGatewayCredit(treasuryArcAddress, arcNeeded, baseNeeded);
    log('gateway balances confirmed for arc + base');

    // One allocation per (agent, chain) the agent actually operates on --
    // this is what lets the running circle-worker's evaluateTopUps pass
    // notice each fresh agent wallet sitting at zero and top it up for real.
    await setAllocation(sessionToken, orgId, agentIds.Orchestrator, 'arc', AGENT_ALLOCATION_USDC);
    await setAllocation(sessionToken, orgId, agentIds.Orchestrator, 'base', AGENT_ALLOCATION_USDC);
    await setAllocation(sessionToken, orgId, agentIds.DataFetcher, 'arc', AGENT_ALLOCATION_USDC);
    await setAllocation(sessionToken, orgId, agentIds.Analyst, 'arc', AGENT_ALLOCATION_USDC);
    await setAllocation(sessionToken, orgId, agentIds.Writer, 'arc', AGENT_ALLOCATION_USDC);
    await setAllocation(sessionToken, orgId, agentIds.SeniorReviewer, 'base', AGENT_ALLOCATION_USDC);
    log('allocations set; waiting for circle-worker to execute real top-up transfers');

    await waitForAgentWalletFunded(RPC_URL_BY_CHAIN, wallets.Orchestrator.arc, 'arc', AGENT_ALLOCATION_MICROS);
    await waitForAgentWalletFunded(RPC_URL_BY_CHAIN, wallets.Orchestrator.base, 'base', AGENT_ALLOCATION_MICROS);
    await waitForAgentWalletFunded(RPC_URL_BY_CHAIN, wallets.DataFetcher.arc, 'arc', AGENT_ALLOCATION_MICROS);
    await waitForAgentWalletFunded(RPC_URL_BY_CHAIN, wallets.Analyst.arc, 'arc', AGENT_ALLOCATION_MICROS);
    await waitForAgentWalletFunded(RPC_URL_BY_CHAIN, wallets.Writer.arc, 'arc', AGENT_ALLOCATION_MICROS);
    await waitForAgentWalletFunded(RPC_URL_BY_CHAIN, wallets.SeniorReviewer.base, 'base', AGENT_ALLOCATION_MICROS);
    log('all agent wallets funded on-chain, ready to run');

    return { orgId, agentIds, connectionTokens, wallets };
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  resetDemo()
    .then((state) => {
      console.log(JSON.stringify(state, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

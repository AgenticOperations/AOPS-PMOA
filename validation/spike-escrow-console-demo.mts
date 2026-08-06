// Piece 4 · Task 6 -- live proof of the escrow -> trust -> Permit2 graduation
// narrative, run against real infrastructure: real Postgres, real Circle
// developer-controlled-wallets API (test mode), real Arc testnet RPC, the
// real deployed ERC-8183 escrow (0x31C0...4e0F5).
//
// No route or UI calls createEscrowJob/fundEscrowJob/applyEscrowStateChange
// today -- piece 2's engine is exercised only by mocked unit tests. This
// script calls the SAME functions the (future) route layer would call,
// exactly the way S8/S9's proof tests did: real functions, not a mock.
//
// Run: cd apps/api && node --env-file=.env ../../node_modules/.bin/tsx ../../validation/spike-escrow-console-demo.mts

import pg from 'pg';
import { createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createOrg, createAgent, type OperatorContext } from '../apps/api/src/engines/identity/store.js';
import {
  createDeveloperControlledCircleTreasuryProvider,
} from '../apps/api/src/engines/payments/circle-provider.js';
import {
  ensureCircleTreasury,
} from '../apps/api/src/engines/payments/store.js';
import {
  enqueueAgentWalletProvisioning,
  processAgentWalletCreateJob,
  findAgentWallet,
} from '../apps/api/src/engines/payments/agent-wallets.js';
import {
  createEscrowJob,
  fundEscrowJob,
  applyEscrowStateChange,
} from '../apps/api/src/engines/payments/escrow.js';
import { getTrustEvidence, trustExternalAgent } from '../apps/api/src/engines/payments/trust.js';
import { drawDown } from '../apps/api/src/engines/payments/permit2.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const provider = createDeveloperControlledCircleTreasuryProvider();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWalletJob(orgId: string, agentId: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const jobResult = await pool.query<{ id: string }>(
      `SELECT id FROM circle_provider_jobs
        WHERE org_id = $1 AND job_type = 'agent_wallet.create' AND status = 'queued'
          AND metadata->>'agent_id' = $2
        ORDER BY created_at DESC LIMIT 1`,
      [orgId, agentId],
    );
    const jobId = jobResult.rows[0]?.id;
    if (jobId !== undefined) {
      await processAgentWalletCreateJob(pool, jobId, provider);
      return;
    }
    await sleep(500);
  }
  throw new Error(`wallet_create_job_not_found:${agentId}`);
}

async function main() {
  const log: Record<string, unknown> = {};

  const bootstrapOperator: OperatorContext = { actorId: 'script:escrow-console-demo', role: 'owner' };
  const ownerEmail = `escrow-demo-${Date.now()}@local.agentops`;
  const org = await createOrg(pool, bootstrapOperator, {
    name: 'Escrow Console Demo',
    owner: { email: ownerEmail, name: 'Demo Operator' },
  });
  const ownerRow = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [ownerEmail]);
  const ownerId = ownerRow.rows[0]?.id;
  if (ownerId === undefined) throw new Error('demo_owner_not_found');
  const operator: OperatorContext = { actorId: ownerId, role: 'owner', userId: ownerId, orgId: org.id };
  log.org = { id: org.id, slug: org.slug };

  await ensureCircleTreasury(pool, operator, org.id, { label: 'Demo treasury' }, provider);

  const clientAgent = await createAgent(pool, operator, org.id, { name: 'Client agent (demo)' });
  const providerAgent = await createAgent(pool, operator, org.id, { name: 'Marketplace provider agent (demo)' });
  log.agents = { client: clientAgent.id, provider: providerAgent.id };

  await enqueueAgentWalletProvisioning(pool, {
    orgId: org.id, agentId: clientAgent.id, mode: 'test', chains: ['arc'], createdBy: operator.actorId,
  });
  await waitForWalletJob(org.id, clientAgent.id);
  await enqueueAgentWalletProvisioning(pool, {
    orgId: org.id, agentId: providerAgent.id, mode: 'test', chains: ['arc'], createdBy: operator.actorId,
  });
  await waitForWalletJob(org.id, providerAgent.id);

  const clientWallet = await findAgentWallet(pool, clientAgent.id, 'test', 'arc');
  const providerWallet = await findAgentWallet(pool, providerAgent.id, 'test', 'arc');
  if (clientWallet === null || providerWallet === null) throw new Error('agent_wallet_provisioning_failed');
  log.wallets = { client: clientWallet.address, provider: providerWallet.address };

  const treasuryWallet = await pool.query<{ address: string }>(
    `SELECT address FROM circle_chain_wallets WHERE org_id = $1 AND mode = 'test' AND chain = 'arc' LIMIT 1`,
    [org.id],
  );
  const treasuryAddress = treasuryWallet.rows[0]?.address;
  if (treasuryAddress === undefined) throw new Error('treasury_wallet_not_found');
  log.treasury = treasuryAddress;

  // Circle's testnet faucet (`/v1/faucet/drips`) returns a real 403 on this
  // dev account -- the same finding spike-results.md already recorded
  // (Circle's own docs gate it behind a mainnet-upgraded account). Fund
  // manually instead, from the same funded EOA prior spikes reused, via a
  // plain signed ERC-20 transfer. Arc's gas token IS USDC (spike S2/S3), so
  // one transfer per address covers both budget and gas.
  const arcUsdc = '0x3600000000000000000000000000000000000000';
  const fundingAccount = privateKeyToAccount(
    (process.env.TREASURY_PRIVATE_KEY ?? '').startsWith('0x')
      ? (process.env.TREASURY_PRIVATE_KEY as `0x${string}`)
      : (`0x${process.env.TREASURY_PRIVATE_KEY}` as `0x${string}`),
  );
  const fundingClient = createWalletClient({
    account: fundingAccount,
    chain: { id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 }, rpcUrls: { default: { http: [process.env.ARC_RPC_URL ?? ''] } } },
    transport: http(process.env.ARC_RPC_URL),
  });
  const erc20Abi = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);
  const FUND_AMOUNT_MICROS = 300_000n; // 0.30 USDC per address -- covers 2 jobs + gas with margin.
  const fundingTxHashes: Record<string, string> = {};
  for (const [label, address] of [
    ['client', clientWallet.address],
    ['provider', providerWallet.address],
    ['treasury', treasuryAddress],
  ] as const) {
    fundingTxHashes[label] = await fundingClient.writeContract({
      address: arcUsdc,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [address as `0x${string}`, FUND_AMOUNT_MICROS],
    });
  }
  log.funding = fundingTxHashes;
  // Give the transfers a moment to land before the first spend.
  await sleep(8000);

  const jobs: Array<Record<string, unknown>> = [];
  for (let i = 1; i <= 2; i += 1) {
    const job = await createEscrowJob(pool, provider, {
      orgId: org.id,
      clientAgentId: clientAgent.id,
      providerAddress: providerWallet.address,
      mode: 'test',
      chain: 'arc',
      budgetUsdc: '0.02',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdBy: operator.actorId,
      description: `AgentOps escrow console demo job ${i}`,
    });
    const funded = await fundEscrowJob(pool, provider, { escrowJobId: job.id });
    const submitted = await applyEscrowStateChange(pool, provider, {
      escrowJobId: job.id,
      next: 'submitted',
      deliverableHash: `0x${'cd'.repeat(32)}`,
    });
    const completed = await applyEscrowStateChange(pool, provider, { escrowJobId: job.id, next: 'completed' });
    jobs.push({
      index: i,
      escrowJobId: job.id,
      onchainJobId: job.onchainJobId,
      createTxHash: job.createTxHash,
      fundTxHash: funded.fundTxHash,
      submitTxHash: submitted.submitTxHash,
      completeTxHash: completed.terminalTxHash,
    });
  }
  log.escrowJobs = jobs;

  const evidenceBefore = await getTrustEvidence(pool, {
    orgId: org.id, chain: 'arc', mode: 'test', address: providerWallet.address,
  });
  log.evidenceBefore = {
    completedCount: evidenceBefore.completedCount,
    settledUsdc: evidenceBefore.settledUsdc,
    trusted: evidenceBefore.trusted,
  };

  const trust = await trustExternalAgent(pool, provider, {
    orgId: org.id,
    chain: 'arc',
    mode: 'test',
    address: providerWallet.address,
    label: 'Marketplace agent A (demo)',
    ceilingUsdc: '0.10',
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    approvedBy: ownerId,
  });
  log.trust = trust;

  const evidenceAfter = await getTrustEvidence(pool, {
    orgId: org.id, chain: 'arc', mode: 'test', address: providerWallet.address,
  });
  log.evidenceAfter = { trusted: evidenceAfter.trusted };

  const drawdown = await drawDown(pool, provider, { delegationId: trust.delegationId, amountUsdc: '0.02' });
  log.permit2Drawdown = drawdown;

  console.log(JSON.stringify(log, null, 2));
}

main()
  .catch((error) => {
    console.error('DEMO_FAILED', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

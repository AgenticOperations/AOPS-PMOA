// Manifest K.4 steps 9-11 + K.5 Moment 3 -- the part of the fleet scenario
// the runnable demo (demo/run.mjs) does NOT cover.
//
// demo/run.mjs proves K.4 steps 1-8 (hub->spoke, second hop, cross-chain) but
// stops there: no route or agent triggers the escrow lifecycle, so steps 9
// (escrow hire), 10 (reputation earned from a settled completion) and 11 /
// Moment 3 (reputation moving capital allocation) had never run live. This
// script drives exactly those, against the SAME already-funded fleet org the
// demo uses, calling the same engine functions a route would call.
//
// Real: real Postgres, real Circle developer-controlled-wallets API (test
// mode), real Arc testnet RPC, the real deployed ERC-8183 escrow
// (0x31C0...4e0F5) and the real ERC-8004 Identity + Reputation registries.
//
// Run: cd apps/api && node --env-file=.env ../../node_modules/.bin/tsx \
//        ../../validation/spike-manifest-k4-completion.mts

import pg from 'pg';
import { registerAgentIdentity } from '../apps/api/src/engines/identity/erc8004.js';
import { createDeveloperControlledCircleTreasuryProvider } from '../apps/api/src/engines/payments/circle-provider.js';
import {
  createEscrowJob,
  fundEscrowJob,
  applyEscrowStateChange,
} from '../apps/api/src/engines/payments/escrow.js';
import { applyReputationAdjustment, setAllocation } from '../apps/api/src/engines/payments/allocations.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const provider = createDeveloperControlledCircleTreasuryProvider();

// The fleet org demo/run.mjs uses, already funded on Arc + Base.
const ORG_ID = 'org_9add7cd3-03eb-471f-85db-7024a9a0a5bd';
const ORCHESTRATOR = 'agt_70b4e169-62b9-4fe1-8462-fd2b600fb4ae';
const DATA_FETCHER = 'agt_e3f92cdf-5825-473c-a47b-21b2f3d0943a';
const WRITER = 'agt_8fcff4e2-0a93-4169-9f98-223f2a05b7f0';
const DATA_FETCHER_WALLET = '0x51b9fe84eb134050c14be08db8aaa27146c816e5';
const ACTOR = 'script:manifest-k4-completion';

async function allocationOf(agentId: string) {
  const r = await pool.query<{
    allocated_usdc: string; gas_reserve_usdc: string; ceiling_usdc: string;
  }>(
    `SELECT allocated_usdc, gas_reserve_usdc, ceiling_usdc FROM agent_allocations
      WHERE org_id = $1 AND agent_id = $2 AND mode = 'test' AND chain = 'arc' AND status = 'active'`,
    [ORG_ID, agentId],
  );
  return r.rows[0];
}

async function main() {
  const out: Record<string, unknown> = {};

  // --- K.4 step 10 prerequisite: the PROVIDER needs an on-chain ERC-8004
  // identity, or onEscrowCompleted writes only the DB event and skips the
  // chain. Registering before completion is what makes the on-chain feedback
  // reachable at all.
  const identity = await registerAgentIdentity(pool, provider, {
    orgId: ORG_ID,
    agentId: DATA_FETCHER,
    mode: 'test',
    chain: 'arc',
    agentUri: 'https://agentops.local/agents/data-fetcher',
  });
  out.step10_identity = {
    tokenId: identity.token_id,
    txHash: identity.register_tx_hash,
    status: identity.status,
  };

  // --- K.4 step 9: one hire runs through ERC-8183 escrow instead of a
  // straight Permit2 drawdown. Orchestrator is client (and, by omitting
  // evaluatorAddress, its own evaluator -- escrow mode 2, matching D2b's rule
  // for an external-but-judgeable counterparty).
  // Idempotent: escrow moves real USDC, so a re-run reuses an already-settled
  // job rather than paying for a second one.
  const existingJob = await pool.query<{
    id: string; onchain_job_id: string | null; create_tx_hash: string | null;
    fund_tx_hash: string | null; submit_tx_hash: string | null; terminal_tx_hash: string | null;
  }>(
    `SELECT id, onchain_job_id, create_tx_hash, fund_tx_hash, submit_tx_hash, terminal_tx_hash
       FROM escrow_jobs WHERE org_id = $1 AND state = 'completed' ORDER BY created_at DESC LIMIT 1`,
    [ORG_ID],
  );
  if (existingJob.rows[0] !== undefined) {
    const j = existingJob.rows[0];
    out.step9_escrow = {
      reusedExisting: true,
      escrowJobId: j.id,
      onchainJobId: j.onchain_job_id,
      createTxHash: j.create_tx_hash,
      fundTxHash: j.fund_tx_hash,
      submitTxHash: j.submit_tx_hash,
      completeTxHash: j.terminal_tx_hash,
    };
  } else {
    const job = await createEscrowJob(pool, provider, {
      orgId: ORG_ID,
      clientAgentId: ORCHESTRATOR,
      providerAddress: DATA_FETCHER_WALLET,
      mode: 'test',
      chain: 'arc',
      budgetUsdc: '0.02',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdBy: ACTOR,
      description: 'Manifest K.4 step 9 -- escrowed hire (Orchestrator -> DataFetcher)',
    });
    const funded = await fundEscrowJob(pool, provider, { escrowJobId: job.id });
    const submitted = await applyEscrowStateChange(pool, provider, {
      escrowJobId: job.id,
      next: 'submitted',
      deliverableHash: `0x${'ab'.repeat(32)}`,
    });
    // Completing fires onEscrowCompleted post-commit -> DB reputation event and,
    // because the identity above exists, a real giveFeedback on-chain.
    const completed = await applyEscrowStateChange(pool, provider, {
      escrowJobId: job.id,
      next: 'completed',
    });
    out.step9_escrow = {
      reusedExisting: false,
      escrowJobId: job.id,
      onchainJobId: job.onchainJobId,
      createTxHash: job.createTxHash,
      fundTxHash: funded.fundTxHash,
      submitTxHash: submitted.submitTxHash,
      completeTxHash: completed.terminalTxHash,
    };
  }

  // --- K.4 step 10: reputation, earned only from a settled completion.
  const events = await pool.query(
    `SELECT id, agent_id, escrow_job_id, score, feedback_tx_hash
       FROM agent_reputation_events WHERE org_id = $1 ORDER BY created_at DESC`,
    [ORG_ID],
  );
  out.step10_reputation = events.rows;

  // --- K.4 step 11 / Moment 3: reputation moves capital.
  // The operator raises the CEILING (an operator act, not a reputation act);
  // reputation then moves the allocation within those bounds. Without
  // headroom the adjustment is a no-op, since allocated == ceiling today.
  const before = await allocationOf(DATA_FETCHER);
  let widened = before!;
  if (before!.ceiling_usdc !== '3.000000') {
    await setAllocation(pool, provider, {
      orgId: ORG_ID, agentId: DATA_FETCHER, mode: 'test', chain: 'arc',
      allocatedUsdc: before!.allocated_usdc,
      gasReserveUsdc: before!.gas_reserve_usdc,
      ceilingUsdc: '3.000000',
      createdBy: ACTOR,
    });
    const applied = await applyReputationAdjustment(pool, provider, {
      orgId: ORG_ID, agentId: DATA_FETCHER, mode: 'test', chain: 'arc',
      reputation: 100, createdBy: ACTOR,
    });
    widened = { ...before!, allocated_usdc: applied.allocated_usdc };
  }

  // The contrast the manifest asks for: "narrows for failures". Writer earned
  // nothing this run, so reputation 0 pulls it toward its floor -- same
  // bounded formula, opposite direction.
  //
  // Precondition, not a workaround: agent_allocations enforces
  // CHECK (allocated_usdc >= low_water_mark_usdc), and demo/reset.mjs seeds
  // low_water == allocated, which pins the allocation and makes ANY downward
  // move impossible. The operator lowering the refill trigger is what creates
  // room to narrow; reputation cannot (and must not) move that bound itself.
  const writerBefore = await allocationOf(WRITER);
  await setAllocation(pool, provider, {
    orgId: ORG_ID, agentId: WRITER, mode: 'test', chain: 'arc',
    allocatedUsdc: writerBefore!.allocated_usdc,
    gasReserveUsdc: writerBefore!.gas_reserve_usdc,
    lowWaterMarkUsdc: '0.500000',
    ceilingUsdc: writerBefore!.ceiling_usdc,
    createdBy: ACTOR,
  });
  const narrowed = await applyReputationAdjustment(pool, provider, {
    orgId: ORG_ID, agentId: WRITER, mode: 'test', chain: 'arc',
    reputation: 0, createdBy: ACTOR,
  });

  out.step11_allocation = {
    dataFetcher: {
      allocatedBefore: before!.allocated_usdc,
      ceilingRaisedTo: '3.000000',
      allocatedAfter: widened.allocated_usdc,
      alreadyAppliedOnEarlierRun: before!.ceiling_usdc === '3.000000',
      reputation: 100,
    },
    writer: {
      allocatedBefore: writerBefore!.allocated_usdc,
      allocatedAfter: narrowed.allocated_usdc,
      floor: writerBefore!.gas_reserve_usdc,
      reputation: 0,
    },
  };

  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((error) => {
    console.error('K4_COMPLETION_FAILED', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

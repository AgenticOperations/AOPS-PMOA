// One-off testnet verification for Phase 8 · Task 1 (docs/superpowers/plans/2026-08-03-phase8-reputation.md).
// Runs the REAL registerAgentIdentity against the REAL running circle-worker
// and the live dev database -- not a parallel hand-rolled path -- so this
// proves the actual application code, the same way piece 1's escrow deploy
// was proven with real transactions rather than a mocked call.
//
// Usage: from apps/api/, with the dev api + circle-worker already running:
//   ../../node_modules/.bin/tsx --env-file=.env scripts/register-agent-identity.ts <agentId> <orgId>
import pg from 'pg';
import { createCircleWorkerTreasuryProvider } from '../src/engines/payments/circle-worker-client.js';
import { registerAgentIdentity } from '../src/engines/identity/erc8004.js';

const [agentId, orgId] = process.argv.slice(2);
if (agentId === undefined || orgId === undefined) {
  console.error('Usage: tsx scripts/register-agent-identity.ts <agentId> <orgId>');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const provider = createCircleWorkerTreasuryProvider({
  baseUrl: process.env.CIRCLE_WORKER_URL ?? 'http://127.0.0.1:8090',
  orgId,
  timeoutMs: Number(process.env.CIRCLE_WORKER_TIMEOUT_MS ?? '180000'),
  token: process.env.CIRCLE_WORKER_TOKEN ?? '',
});

async function main() {
  const identity = await registerAgentIdentity(pool, provider, {
    orgId,
    agentId,
    mode: 'test',
    chain: 'arc',
    agentUri: `https://agentops.example/agents/${agentId}.json`,
  });
  console.log(JSON.stringify(identity, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import { fundAgentFromUserDelegation } from '../../src/engines/payments/agent-funding.js';
import { recordProvisionedWallet } from '../../src/engines/payments/agent-wallets.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

// Just-in-time funding is what replaces the allocation + treasury top-up
// path in the non-custodial model. Instead of the operator moving USDC into
// a custodied treasury and allocating it out in advance, the money stays in
// their own wallet and an agent draws only what it is about to spend.

function fakeProvider(overrides: Partial<CircleTreasuryProvider> = {}): CircleTreasuryProvider {
  return {
    bridgeWalletTopUp: vi.fn(),
    createWallet: vi.fn(),
    createWalletSet: vi.fn(),
    executePermit2Transaction: vi.fn(() => Promise.resolve({ txHash: '0xjitdraw' })),
    getGatewayBalance: vi.fn(),
    getWalletBalances: vi.fn(),
    health: vi.fn(),
    initiateGatewayDeposit: vi.fn(),
    requestTestnetFunds: vi.fn(),
    settleExactX402: vi.fn(),
    settleGatewayX402: vi.fn(),
    signPermit2Delegation: vi.fn(),
    transferWallet: vi.fn(),
    ...overrides,
  };
}

const USER_WALLET = '0xu5e40000000000000000000000000000000000f1';

describe('just-in-time funding from a user-owned delegation', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    if (store !== undefined) await store.stop();
  });

  async function setupAgent(
    suffix: string,
    delegation: { readonly ceilingUsdc: string; readonly drawnUsdc?: string; readonly userOwned: boolean } | null,
  ) {
    const orgId = `org_jit_${suffix}`;
    const teamId = `team_jit_${suffix}`;
    const agentId = `agt_jit_${suffix}`;
    const agentAddress = `0xa9e17${suffix.padEnd(35, '0').slice(0, 35)}`;

    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'JIT Org')", [orgId]);
    await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      agentId, orgId, teamId, 'JIT Agent',
    ]);
    const walletSetId = `ws_jit_${suffix}`;
    await store.pool.query(
      `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
       VALUES ($1, $2, 'test', $3, 'JIT wallet set', 'usr_1')`,
      [walletSetId, orgId, `circle_${walletSetId}`],
    );
    await recordProvisionedWallet(store.pool, {
      orgId, agentId, mode: 'test', chain: 'arc',
      circleWalletId: `w_jit_${suffix}`, address: agentAddress,
      refId: `ref_jit_${suffix}`, walletSetId, circleBlockchain: 'ARC-TESTNET',
    });

    if (delegation !== null) {
      await store.pool.query(
        `INSERT INTO agent_delegations (
           id, org_id, payer_agent_id, payer_address, payee_agent_id, payee_address, mode, chain,
           token_address, ceiling_usdc, drawn_usdc, expires_at, permit_nonce, signature,
           status, approved_by
         ) VALUES ($1, $2, $3, $4, $5, $6, 'test', 'arc', $7, $8, $9, $10, 0, '0xsig', 'active', 'usr_1')`,
        [
          `dele_jit_${suffix}`, orgId,
          delegation.userOwned ? null : agentId,
          delegation.userOwned ? USER_WALLET : agentAddress,
          agentId, agentAddress,
          '0x3600000000000000000000000000000000000000',
          delegation.ceilingUsdc, delegation.drawnUsdc ?? '0',
          new Date(Date.now() + 3_600_000),
        ],
      );
    }

    return { orgId, agentId, agentAddress };
  }

  it('draws only the shortfall, leaving what the agent already earned', async () => {
    const { orgId, agentId } = await setupAgent('shortfall', { ceilingUsdc: '5.00', userOwned: true });
    const executePermit2Transaction = vi.fn(() => Promise.resolve({ txHash: '0xshortfall' }));
    // Agent holds 0.30; about to spend 1.00 -> draw 0.70, not the full 1.00.
    const balance = vi.fn(() => Promise.resolve(300_000n));

    const result = await fundAgentFromUserDelegation(
      store.pool,
      fakeProvider({ executePermit2Transaction }),
      balance,
      { orgId, agentId, mode: 'test', chain: 'arc', neededMicros: 1_000_000n },
    );

    expect(result).toEqual({ funded: true, amountUsdc: '0.700000', txHash: '0xshortfall' });
    const drawn = await store.pool.query<{ drawn_usdc: string }>(
      'SELECT drawn_usdc FROM agent_delegations WHERE org_id = $1', [orgId],
    );
    expect(Number(drawn.rows[0]?.drawn_usdc)).toBe(0.7);
  });

  it('does nothing when the agent already holds enough', async () => {
    const { orgId, agentId } = await setupAgent('enough', { ceilingUsdc: '5.00', userOwned: true });
    const executePermit2Transaction = vi.fn(() => Promise.resolve({ txHash: '0xunused' }));
    const balance = vi.fn(() => Promise.resolve(2_000_000n));

    const result = await fundAgentFromUserDelegation(
      store.pool,
      fakeProvider({ executePermit2Transaction }),
      balance,
      { orgId, agentId, mode: 'test', chain: 'arc', neededMicros: 1_000_000n },
    );

    expect(result).toEqual({ funded: false, reason: 'already_funded' });
    expect(executePermit2Transaction).not.toHaveBeenCalled();
  });

  it('ignores an agent-owned delegation -- only the operator funds an agent', async () => {
    // A delegation whose payer is the agent itself is the custodial,
    // agent-to-agent shape. Drawing on it here would have the agent paying
    // itself, which funds nothing and would burn its Permit2 headroom.
    const { orgId, agentId } = await setupAgent('agentowned', { ceilingUsdc: '5.00', userOwned: false });
    const executePermit2Transaction = vi.fn(() => Promise.resolve({ txHash: '0xunused' }));
    const balance = vi.fn(() => Promise.resolve(0n));

    const result = await fundAgentFromUserDelegation(
      store.pool,
      fakeProvider({ executePermit2Transaction }),
      balance,
      { orgId, agentId, mode: 'test', chain: 'arc', neededMicros: 1_000_000n },
    );

    expect(result).toEqual({ funded: false, reason: 'no_user_delegation' });
    expect(executePermit2Transaction).not.toHaveBeenCalled();
  });

  it('does not draw past the delegation ceiling', async () => {
    // Ceiling 1.00 with 0.80 already drawn leaves 0.20, short of the 1.00
    // shortfall. Partially funding would leave the agent unable to pay
    // anyway, having spent headroom for nothing.
    const { orgId, agentId } = await setupAgent('ceiling', {
      ceilingUsdc: '1.00', drawnUsdc: '0.80', userOwned: true,
    });
    const executePermit2Transaction = vi.fn(() => Promise.resolve({ txHash: '0xunused' }));
    const balance = vi.fn(() => Promise.resolve(0n));

    const result = await fundAgentFromUserDelegation(
      store.pool,
      fakeProvider({ executePermit2Transaction }),
      balance,
      { orgId, agentId, mode: 'test', chain: 'arc', neededMicros: 1_000_000n },
    );

    expect(result).toEqual({ funded: false, reason: 'no_user_delegation' });
    expect(executePermit2Transaction).not.toHaveBeenCalled();
  });

  it('reports no delegation rather than throwing, so the custodial path still runs', async () => {
    const { orgId, agentId } = await setupAgent('none', null);
    const result = await fundAgentFromUserDelegation(
      store.pool,
      fakeProvider(),
      vi.fn(() => Promise.resolve(0n)),
      { orgId, agentId, mode: 'test', chain: 'arc', neededMicros: 1_000_000n },
    );
    expect(result).toEqual({ funded: false, reason: 'no_user_delegation' });
  });
});

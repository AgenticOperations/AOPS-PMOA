import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import type { EscrowState } from '../../src/engines/payments/escrow.js';
import { getTrustEvidence, revokeTrust, trustExternalAgent } from '../../src/engines/payments/trust.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

const ESCROW_ADDRESS = '0x31C050d9D20504c4E11b2A894051d8181B14e0F5';
const ARC_USDC = '0x3600000000000000000000000000000000000000';

function fakeProvider(overrides: Partial<CircleTreasuryProvider> = {}): CircleTreasuryProvider {
  return {
    bridgeWalletTopUp: vi.fn(),
    createWallet: vi.fn(),
    createWalletSet: vi.fn(),
    executePermit2Transaction: vi.fn(() => Promise.resolve({ txHash: '0xtx' })),
    getGatewayBalance: vi.fn(),
    getWalletBalances: vi.fn(),
    health: vi.fn(),
    initiateGatewayDeposit: vi.fn(),
    requestTestnetFunds: vi.fn(),
    settleExactX402: vi.fn(),
    settleGatewayX402: vi.fn(),
    signPermit2Delegation: vi.fn(() => Promise.resolve({ signature: '0xsig' })),
    transferWallet: vi.fn(),
    transferNativeGas: vi.fn(),
    ...overrides,
  };
}

/** Addresses must be real hex -- the engine hands them straight to Circle/RPC calls. */
function hexAddress(prefix: string, suffix: string): string {
  const seed = [...suffix].map((c) => c.charCodeAt(0).toString(16)).join('');
  return `0x${`${prefix}${seed}`.padEnd(40, '0').slice(0, 40)}`;
}

/**
 * Stubs Arc's RPC for the two DIFFERENT reads a treasury-payer delegation
 * shares one RPC for: eth_getBalance (solvency) and eth_call -> Permit2
 * allowance() (the nonce). Returning the same answer for both parses a
 * balance as a nonce and overflows the bigint permit_nonce column --
 * confirmed live, see delegation-routes.test.ts.
 */
function stubArcRpc(balanceWei: bigint): () => void {
  vi.stubEnv('ARC_RPC_URL', 'https://rpc.testnet.arc.network');
  const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation((_url, init) => {
    const { method } = JSON.parse(String((init as { body?: unknown }).body)) as { method: string };
    const result = method === 'eth_getBalance'
      ? `0x${balanceWei.toString(16)}`
      : `0x${'0'.repeat(192)}`; // amount/expiration/nonce words, nonce 0
    return Promise.resolve(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result })));
  });
  return () => {
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  };
}

describe('escrow trust graduation', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    if (store !== undefined) await store.stop();
  });

  type TrustFixture = {
    readonly orgId: string;
    readonly clientAgentId: string;
    readonly treasuryAddress: string;
  };

  /** An org with a client agent and, by default, a funded treasury wallet on Arc. */
  async function seedTrustOrg(suffix: string, options: { readonly withTreasury?: boolean } = {}): Promise<TrustFixture> {
    const orgId = `org_trust_${suffix}`;
    const teamId = `team_trust_${suffix}`;
    const clientAgentId = `agt_trust_client_${suffix}`;
    const walletSetId = `ws_trust_${suffix}`;
    const treasuryAddress = hexAddress('7ea5', suffix);

    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'Trust Org')", [orgId]);
    await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      clientAgentId, orgId, teamId, 'Client Agent',
    ]);
    if (options.withTreasury !== false) {
      await store.pool.query(
        `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
         VALUES ($1, $2, 'test', $3, 'Trust wallet set', 'usr_1')`,
        [walletSetId, orgId, `circle_${walletSetId}`],
      );
      await store.pool.query(
        `INSERT INTO circle_chain_wallets
           (id, org_id, wallet_set_id, mode, chain, circle_blockchain,
            circle_wallet_id, address, account_type, metadata)
         VALUES ($1, $2, $3, 'test', 'arc', 'ARC-TESTNET', $4, $5, 'eoa', '{}'::jsonb)`,
        [`cwallet_trust_${suffix}`, orgId, walletSetId, `circlewallet_trust_${suffix}`, treasuryAddress],
      );
    }

    return { orgId, clientAgentId, treasuryAddress };
  }

  /** A raw escrow_jobs row -- bypasses the lifecycle engine, which piece 3 does not depend on. */
  async function seedEscrowJob(
    fixture: TrustFixture,
    options: { readonly providerAddress: string; readonly state: EscrowState; readonly budgetUsdc: string },
  ): Promise<string> {
    const id = `esjob_${randomUUID()}`;
    await store.pool.query(
      `INSERT INTO escrow_jobs (
         id, org_id, client_agent_id, provider_address, evaluator_address, mode, chain,
         escrow_address, token_address, budget_usdc, state, escrow_mode, expires_at, created_by
       ) VALUES ($1, $2, $3, $4, $4, 'test', 'arc', $5, $6, $7::numeric, $8, 2, $9, 'usr_1')`,
      [
        id, fixture.orgId, fixture.clientAgentId, options.providerAddress,
        ESCROW_ADDRESS, ARC_USDC, options.budgetUsdc, options.state,
        new Date(Date.now() + 86_400_000),
      ],
    );
    return id;
  }

  async function seedAllowlist(input: {
    readonly orgId: string;
    readonly address: string;
    readonly status: 'active' | 'revoked';
  }): Promise<void> {
    await store.pool.query(
      `INSERT INTO payment_destination_allowlist (id, org_id, chain, address, label, source, status, created_by, approved_by)
       VALUES ($1, $2, 'arc', $3, 'Test allowlist row', 'marketplace', $4, 'usr_1', 'usr_1')`,
      [`payto_${randomUUID()}`, input.orgId, input.address, input.status],
    );
  }

  // -----------------------------------------------------------------------
  // Chunk 1: Evidence
  // -----------------------------------------------------------------------

  describe('escrow evidence for an external agent', () => {
    it('summarises settled work per provider address', async () => {
      const fixture = await seedTrustOrg('summary');
      const provider = hexAddress('9e57', 'summary');
      await seedEscrowJob(fixture, { providerAddress: provider, state: 'completed', budgetUsdc: '5.00' });
      await seedEscrowJob(fixture, { providerAddress: provider, state: 'completed', budgetUsdc: '7.00' });
      await seedEscrowJob(fixture, { providerAddress: provider, state: 'rejected', budgetUsdc: '3.00' });

      const ev = await getTrustEvidence(store.pool, { orgId: fixture.orgId, chain: 'arc', mode: 'test', address: provider });

      expect(ev.completedCount).toBe(2);
      expect(ev.settledUsdc).toBe('12.000000');
      expect(ev.rejectedCount).toBe(1);
      expect(ev.trusted).toBe(false);
      expect(ev.jobs).toHaveLength(3);
    });

    it('sums settled budgets across completed jobs', async () => {
      const fixture = await seedTrustOrg('sum');
      const provider = hexAddress('9e57', 'sum');
      await seedEscrowJob(fixture, { providerAddress: provider, state: 'completed', budgetUsdc: '5.00' });
      await seedEscrowJob(fixture, { providerAddress: provider, state: 'completed', budgetUsdc: '7.00' });

      const ev = await getTrustEvidence(store.pool, { orgId: fixture.orgId, chain: 'arc', mode: 'test', address: provider });
      expect(ev.settledUsdc).toBe('12.000000');
    });

    it('counts expired separately from rejected', async () => {
      // The chain refunds both identically, but "delivered but never
      // evaluated" is not the same signal to a human as "rejected".
      const fixture = await seedTrustOrg('expired');
      const provider = hexAddress('9e57', 'expired');
      await seedEscrowJob(fixture, { providerAddress: provider, state: 'expired', budgetUsdc: '2.00' });

      const ev = await getTrustEvidence(store.pool, { orgId: fixture.orgId, chain: 'arc', mode: 'test', address: provider });
      expect(ev.expiredCount).toBe(1);
      expect(ev.rejectedCount).toBe(0);
    });

    it('reports trusted once an active allowlist row exists', async () => {
      const fixture = await seedTrustOrg('trusted');
      const provider = hexAddress('9e57', 'trusted');
      await seedAllowlist({ orgId: fixture.orgId, address: provider, status: 'active' });

      const ev = await getTrustEvidence(store.pool, { orgId: fixture.orgId, chain: 'arc', mode: 'test', address: provider });
      expect(ev.trusted).toBe(true);
    });

    it('is scoped to the org -- one org trusting an agent tells another nothing', async () => {
      const fixture = await seedTrustOrg('scopeda');
      const otherFixture = await seedTrustOrg('scopedb');
      const provider = hexAddress('9e57', 'shared');
      await seedAllowlist({ orgId: otherFixture.orgId, address: provider, status: 'active' });

      const ev = await getTrustEvidence(store.pool, { orgId: fixture.orgId, chain: 'arc', mode: 'test', address: provider });
      expect(ev.trusted).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Chunk 2: Promotion
  // -----------------------------------------------------------------------

  describe('promoting an external agent', () => {
    it('records the real approver, never the system', async () => {
      const fixture = await seedTrustOrg('promote');
      const provider = hexAddress('9e57', 'promote');
      await seedEscrowJob(fixture, { providerAddress: provider, state: 'completed', budgetUsdc: '5.00' });
      const unstub = stubArcRpc(100n * 10n ** 18n);

      await trustExternalAgent(store.pool, fakeProvider(), {
        orgId: fixture.orgId, chain: 'arc', mode: 'test', address: provider,
        label: 'Marketplace agent A', ceilingUsdc: '10.00',
        expiresAt: new Date(Date.now() + 30 * 86_400_000), approvedBy: 'user_42',
      });

      const row = await store.pool.query<{ source: string; status: string; approved_by: string }>(
        'SELECT source, status, approved_by FROM payment_destination_allowlist WHERE org_id = $1 AND lower(address) = lower($2)',
        [fixture.orgId, provider],
      );
      expect(row.rows[0]?.source).toBe('marketplace');
      expect(row.rows[0]?.status).toBe('active');
      // The whole point of the design: a person decided this.
      expect(row.rows[0]?.approved_by).toBe('user_42');
      expect(row.rows[0]?.approved_by).not.toBe('system');
      unstub();
    });

    it('opens a Permit2 delegation naming the external address as payee', async () => {
      const fixture = await seedTrustOrg('delegate');
      const provider = hexAddress('9e57', 'delegate');
      await seedEscrowJob(fixture, { providerAddress: provider, state: 'completed', budgetUsdc: '5.00' });
      const unstub = stubArcRpc(100n * 10n ** 18n);

      const result = await trustExternalAgent(store.pool, fakeProvider(), {
        orgId: fixture.orgId, chain: 'arc', mode: 'test', address: provider,
        label: 'Marketplace agent A', ceilingUsdc: '10.00',
        expiresAt: new Date(Date.now() + 30 * 86_400_000), approvedBy: 'user_42',
      });

      const del = await store.pool.query<{
        payee_address: string; payee_agent_id: string | null; ceiling_usdc: string; payer_kind: string;
      }>(
        'SELECT payee_address, payee_agent_id, ceiling_usdc, payer_kind FROM agent_delegations WHERE id = $1',
        [result.delegationId],
      );
      expect(del.rows[0]?.payee_address.toLowerCase()).toBe(provider.toLowerCase());
      // External: not one of our agents.
      expect(del.rows[0]?.payee_agent_id).toBeNull();
      expect(del.rows[0]?.ceiling_usdc).toBe('10.000000');
      expect(del.rows[0]?.payer_kind).toBe('treasury');
      unstub();
    });

    it('refuses to promote an agent with no settled escrow history', async () => {
      // Evidence is what makes this a judgement rather than a guess. Without
      // any completed job there is nothing for a human to have reviewed.
      const fixture = await seedTrustOrg('nohistory');
      const provider = hexAddress('9e57', 'nohistory');

      await expect(trustExternalAgent(store.pool, fakeProvider(), {
        orgId: fixture.orgId, chain: 'arc', mode: 'test', address: provider,
        label: 'Nobody', ceilingUsdc: '10.00',
        expiresAt: new Date(Date.now() + 30 * 86_400_000), approvedBy: 'user_42',
      })).rejects.toThrow(/trust_requires_escrow_history/);
    });

    it('is idempotent -- promoting twice does not double-delegate', async () => {
      const fixture = await seedTrustOrg('twice');
      const provider = hexAddress('9e57', 'twice');
      await seedEscrowJob(fixture, { providerAddress: provider, state: 'completed', budgetUsdc: '5.00' });
      const unstub = stubArcRpc(100n * 10n ** 18n);
      const input = {
        orgId: fixture.orgId, chain: 'arc' as const, mode: 'test' as const, address: provider,
        label: 'Marketplace agent A', ceilingUsdc: '10.00',
        expiresAt: new Date(Date.now() + 30 * 86_400_000), approvedBy: 'user_42',
      };

      await trustExternalAgent(store.pool, fakeProvider(), input);
      await expect(trustExternalAgent(store.pool, fakeProvider(), input))
        .rejects.toThrow(/agent_already_trusted/);

      const delegations = await store.pool.query<{ count: string }>(
        'SELECT count(*) FROM agent_delegations WHERE org_id = $1 AND lower(payee_address) = lower($2)',
        [fixture.orgId, provider],
      );
      expect(Number(delegations.rows[0]?.count)).toBe(1);
      unstub();
    });

    it('rolls the allowlist insert back when the delegation fails', async () => {
      // A checkmark with no delegation behind it is a lie the console would
      // display. No treasury wallet at all is the simplest way to make
      // recordSignedDelegation fail deterministically, and it fails before
      // any RPC or provider call -- no stubbing needed.
      const fixture = await seedTrustOrg('rollback', { withTreasury: false });
      const provider = hexAddress('9e57', 'rollback');
      await seedEscrowJob(fixture, { providerAddress: provider, state: 'completed', budgetUsdc: '5.00' });

      await expect(trustExternalAgent(store.pool, fakeProvider(), {
        orgId: fixture.orgId, chain: 'arc', mode: 'test', address: provider,
        label: 'Marketplace agent A', ceilingUsdc: '10.00',
        expiresAt: new Date(Date.now() + 30 * 86_400_000), approvedBy: 'user_42',
      })).rejects.toThrow(/org_treasury_wallet_not_found/);

      const allowlist = await store.pool.query<{ count: string }>(
        'SELECT count(*) FROM payment_destination_allowlist WHERE org_id = $1 AND lower(address) = lower($2)',
        [fixture.orgId, provider],
      );
      expect(Number(allowlist.rows[0]?.count)).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Chunk 2: Revocation
  // -----------------------------------------------------------------------

  describe('revoking an external agent', () => {
    async function promoted(suffix: string) {
      const fixture = await seedTrustOrg(suffix);
      const provider = hexAddress('9e57', suffix);
      await seedEscrowJob(fixture, { providerAddress: provider, state: 'completed', budgetUsdc: '5.00' });
      const unstub = stubArcRpc(100n * 10n ** 18n);
      const executePermit2Transaction = vi.fn(() => Promise.resolve({ txHash: '0xtx' }));
      const circleProvider = fakeProvider({ executePermit2Transaction });

      const { delegationId } = await trustExternalAgent(store.pool, circleProvider, {
        orgId: fixture.orgId, chain: 'arc', mode: 'test', address: provider,
        label: 'Marketplace agent A', ceilingUsdc: '10.00',
        expiresAt: new Date(Date.now() + 30 * 86_400_000), approvedBy: 'user_42',
      });

      return { fixture, provider, delegationId, executePermit2Transaction, circleProvider, unstub };
    }

    it('revokes the allowlist entry and the on-chain permit together', async () => {
      const { fixture, provider, delegationId, executePermit2Transaction, circleProvider, unstub } = await promoted('revoke');
      executePermit2Transaction.mockClear();

      await revokeTrust(store.pool, circleProvider, {
        orgId: fixture.orgId, chain: 'arc', mode: 'test', address: provider, revokedBy: 'user_42',
      });

      const allowlist = await store.pool.query<{ status: string }>(
        'SELECT status FROM payment_destination_allowlist WHERE org_id = $1 AND lower(address) = lower($2)',
        [fixture.orgId, provider],
      );
      expect(allowlist.rows[0]?.status).toBe('revoked');

      const delegation = await store.pool.query<{ status: string }>(
        'SELECT status FROM agent_delegations WHERE id = $1', [delegationId],
      );
      expect(delegation.rows[0]?.status).toBe('revoked');
      // Revoking locally while the on-chain allowance survives would leave
      // real spending authority in place. The permit must actually be
      // revoked -- this is exactly the case the payer_kind fix guards.
      expect(executePermit2Transaction).toHaveBeenCalled();
      const call = (executePermit2Transaction.mock.calls as unknown[][])[0]?.[0] as { abiFunctionSignature?: string };
      expect(call.abiFunctionSignature).toContain('lockdown');
      unstub();
    });

    it('leaves completed escrow history intact after revocation', async () => {
      const { fixture, provider, circleProvider, unstub } = await promoted('history');

      await revokeTrust(store.pool, circleProvider, {
        orgId: fixture.orgId, chain: 'arc', mode: 'test', address: provider, revokedBy: 'user_42',
      });

      const ev = await getTrustEvidence(store.pool, { orgId: fixture.orgId, chain: 'arc', mode: 'test', address: provider });
      expect(ev.completedCount).toBe(1); // history is evidence, not a grant
      expect(ev.trusted).toBe(false);
      unstub();
    });

    it('refuses to revoke an agent that is not currently trusted', async () => {
      const fixture = await seedTrustOrg('nottrusted');
      const provider = hexAddress('9e57', 'nottrusted');

      await expect(revokeTrust(store.pool, fakeProvider(), {
        orgId: fixture.orgId, chain: 'arc', mode: 'test', address: provider, revokedBy: 'user_42',
      })).rejects.toThrow(/agent_not_trusted/);
    });
  });
});

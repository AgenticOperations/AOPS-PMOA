import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { recordProvisionedWallet } from '../../src/engines/payments/agent-wallets.js';
import type { CircleTreasuryProvider } from '../../src/engines/payments/circle-provider.js';
import {
  IDENTITY_REGISTRY_ADDRESS,
  registerAgentIdentity,
  type Erc8004ReceiptLog,
} from '../../src/engines/identity/erc8004.js';
import { startPostgres, type PostgresTestStore } from '../helpers/postgres.js';

// keccak256("Registered(uint256,string,address)"), computed via viem's
// toEventSelector rather than hand-derived -- a real log shape, not a guess.
const REGISTERED_TOPIC = '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a';

function word(hexNoPrefix: string): string {
  return hexNoPrefix.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

/** ABI-encodes a single non-indexed dynamic `string` argument. */
function stringData(value: string): string {
  const bytes = Buffer.from(value, 'utf8');
  const lengthWord = word(bytes.length.toString(16));
  const paddedHexLength = Math.ceil(bytes.length / 32) * 64;
  const dataHex = bytes.toString('hex').padEnd(paddedHexLength, '0');
  return `${lengthWord}${dataHex}`;
}

/** A real Registered log: agentId/owner indexed, agentURI in `data`. */
function registeredLog(
  agentId: bigint,
  owner: string,
  agentUri: string,
  address = IDENTITY_REGISTRY_ADDRESS,
): Erc8004ReceiptLog {
  return {
    address,
    topics: [REGISTERED_TOPIC, `0x${word(agentId.toString(16))}`, `0x${word(owner)}`],
    data: `0x${word('20')}${stringData(agentUri)}`,
  };
}

function recordingExecutor() {
  return vi.fn((input: { readonly abiFunctionSignature: string }) =>
    Promise.resolve({ txHash: `0x${input.abiFunctionSignature.split('(')[0]}tx` }));
}

function fakeProvider(overrides: Partial<CircleTreasuryProvider> = {}): CircleTreasuryProvider {
  return {
    bridgeWalletTopUp: vi.fn(),
    createWallet: vi.fn(),
    createWalletSet: vi.fn(),
    executePermit2Transaction: recordingExecutor(),
    getGatewayBalance: vi.fn(),
    getWalletBalances: vi.fn(),
    health: vi.fn(),
    initiateGatewayDeposit: vi.fn(),
    requestTestnetFunds: vi.fn(),
    settleExactX402: vi.fn(),
    settleGatewayX402: vi.fn(),
    signPermit2Delegation: vi.fn(),
    transferWallet: vi.fn(),
    transferNativeGas: vi.fn(),
    ...overrides,
  };
}

function hexAddress(prefix: string, suffix: string): string {
  const seed = [...suffix].map((c) => c.charCodeAt(0).toString(16)).join('');
  return `0x${`${prefix}${seed}`.padEnd(40, '0').slice(0, 40)}`;
}

describe('ERC-8004 identity registration', () => {
  let store: PostgresTestStore;

  beforeAll(async () => {
    store = await startPostgres();
  }, 90_000);

  afterAll(async () => {
    if (store !== undefined) await store.stop();
  });

  type AgentFixture = {
    readonly orgId: string;
    readonly agentId: string;
    readonly address: string;
  };

  async function seedAgentFixture(suffix: string, options: { readonly withWallet?: boolean } = {}): Promise<AgentFixture> {
    const orgId = `org_erc8004_${suffix}`;
    const teamId = `team_erc8004_${suffix}`;
    const agentId = `agt_erc8004_${suffix}`;
    const walletSetId = `ws_erc8004_${suffix}`;
    const address = hexAddress('a604', suffix);

    await store.pool.query("INSERT INTO orgs (id, display_name) VALUES ($1, 'ERC-8004 Org')", [orgId]);
    await store.pool.query('INSERT INTO teams (id, org_id, name) VALUES ($1, $2, $3)', [teamId, orgId, 'Default Team']);
    await store.pool.query('INSERT INTO agents (id, org_id, team_id, name) VALUES ($1, $2, $3, $4)', [
      agentId, orgId, teamId, 'Identity Agent',
    ]);
    if (options.withWallet !== false) {
      await store.pool.query(
        `INSERT INTO circle_wallet_sets (id, org_id, mode, circle_wallet_set_id, label, created_by)
         VALUES ($1, $2, 'test', $3, 'ERC-8004 wallet set', 'usr_1')`,
        [walletSetId, orgId, `circle_${walletSetId}`],
      );
      await recordProvisionedWallet(store.pool, {
        orgId, agentId, mode: 'test', chain: 'arc',
        circleWalletId: `w_erc8004_${suffix}`, address,
        refId: `ref_erc8004_${suffix}`, walletSetId, circleBlockchain: 'ARC-TESTNET',
      });
    }

    return { orgId, agentId, address };
  }

  let nextAgentTokenId = 100n;

  it('registers an agent and records its token id', async () => {
    const fixture = await seedAgentFixture('register');
    const tokenId = (nextAgentTokenId += 1n);
    const identity = await registerAgentIdentity(store.pool, fakeProvider(), {
      orgId: fixture.orgId,
      agentId: fixture.agentId,
      mode: 'test',
      chain: 'arc',
      agentUri: 'https://example.test/agents/register.json',
      readReceiptLogs: () => Promise.resolve([registeredLog(tokenId, fixture.address, 'https://example.test/agents/register.json')]),
    });

    expect(identity.status).toBe('registered');
    expect(identity.token_id).toBe(tokenId.toString());
    expect(identity.registry_address).toBe(IDENTITY_REGISTRY_ADDRESS);

    const row = await store.pool.query<{ status: string; token_id: string | null }>(
      'SELECT status, token_id FROM agent_onchain_identities WHERE agent_id = $1', [fixture.agentId],
    );
    expect(row.rows[0]?.status).toBe('registered');
    expect(row.rows[0]?.token_id).not.toBeNull();
  });

  it('is idempotent -- re-registering does not mint a second identity', async () => {
    const fixture = await seedAgentFixture('idempotent');
    const tokenId = (nextAgentTokenId += 1n);
    const executePermit2Transaction = recordingExecutor();
    const provider = fakeProvider({ executePermit2Transaction });
    const input = {
      orgId: fixture.orgId,
      agentId: fixture.agentId,
      mode: 'test' as const,
      chain: 'arc' as const,
      agentUri: 'https://example.test/agents/idempotent.json',
      readReceiptLogs: () => Promise.resolve([registeredLog(tokenId, fixture.address, 'https://example.test/agents/idempotent.json')]),
    };

    await registerAgentIdentity(store.pool, provider, input);
    await registerAgentIdentity(store.pool, provider, input);

    const rows = await store.pool.query('SELECT 1 FROM agent_onchain_identities WHERE agent_id = $1', [fixture.agentId]);
    expect(rows.rowCount).toBe(1);
    // The second call must not have minted again -- no second on-chain call.
    expect(executePermit2Transaction).toHaveBeenCalledTimes(1);
  });

  it('throws when the agent has no wallet on that chain', async () => {
    const fixture = await seedAgentFixture('nowallet', { withWallet: false });
    await expect(
      registerAgentIdentity(store.pool, fakeProvider(), {
        orgId: fixture.orgId,
        agentId: fixture.agentId,
        mode: 'test',
        chain: 'arc',
        agentUri: 'https://example.test/agents/nowallet.json',
      }),
    ).rejects.toMatchObject({
      code: 'erc8004_agent_wallet_not_found',
      statusCode: 409,
      message: expect.stringMatching(/does not have an Arc wallet/i),
    });
  });

  it('throws rather than guessing when the receipt carries no Registered log', async () => {
    const fixture = await seedAgentFixture('badreceipt');
    await expect(
      registerAgentIdentity(store.pool, fakeProvider(), {
        orgId: fixture.orgId,
        agentId: fixture.agentId,
        mode: 'test',
        chain: 'arc',
        agentUri: 'https://example.test/agents/badreceipt.json',
        readReceiptLogs: () => Promise.resolve([]),
      }),
    ).rejects.toThrow(/erc8004_agent_id_not_in_receipt/);
  });
});

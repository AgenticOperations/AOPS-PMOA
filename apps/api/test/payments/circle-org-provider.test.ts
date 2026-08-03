import { describe, expect, it, vi } from 'vitest';
import type { CircleAgentCliExecutor } from '../../src/engines/payments/circle-agent-cli.js';
import type { CircleConnectionService } from '../../src/engines/payments/circle-connection-service.js';
import { createOrgScopedCircleTreasuryProvider } from '../../src/engines/payments/circle-org-provider.js';

describe('Organization-scoped Circle provider', () => {
  it('executes provider calls through the selected organization connection', async () => {
    const executor = {
      status: vi.fn(() => Promise.resolve({
        live: { email: null, expiresIn: null, tokenStatus: 'UNKNOWN' },
        test: { email: 'owner@example.com', expiresIn: '7d', tokenStatus: 'VALID' },
      })),
    } as unknown as CircleAgentCliExecutor;
    const withConnectedExecutor = vi.fn((
      _input: { readonly orgId: string },
      operation: (scopedExecutor: CircleAgentCliExecutor) => Promise<unknown>,
    ) => operation(executor));
    const service = { withConnectedExecutor } as unknown as CircleConnectionService;
    const provider = createOrgScopedCircleTreasuryProvider(service, 'org_1');

    const walletSet = await provider.createWalletSet({ label: 'Treasury', mode: 'test', orgId: 'org_1' });

    expect(walletSet.circleWalletSetId).toBe('circle_agent_wallet:test:owner@example.com');
    expect(withConnectedExecutor).toHaveBeenCalledWith({ orgId: 'org_1' }, expect.any(Function));
  });

  it('rejects live health because the current product is testnet only', () => {
    const service = {} as CircleConnectionService;
    const provider = createOrgScopedCircleTreasuryProvider(service, 'org_1');

    expect(provider.health('test').configured).toBe(true);
    expect(provider.health('live')).toMatchObject({ configured: false, missing: ['testnet_only'] });
  });

  it('uses the developer-controlled provider when CIRCLE_TREASURY_PROVIDER is set', async () => {
    vi.stubEnv('CIRCLE_TREASURY_PROVIDER', 'developer_controlled');

    const service = {} as CircleConnectionService;
    const provider = createOrgScopedCircleTreasuryProvider(service, 'org_1');
    const result = await provider.bridgeWalletTopUp({
      amount: '1.00',
      fromAddress: '0x0000000000000000000000000000000000000001',
      fromChain: 'arc',
      mode: 'test',
      toAddress: '0x0000000000000000000000000000000000000002',
      toChain: 'base',
    });

    // The dev-controlled provider stubs this; the Agent Wallet path does
    // not need a connected executor at all to reach it, since
    // createDeveloperControlledCircleTreasuryProvider() authenticates with
    // the entity secret rather than a per-org OAuth connection.
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe('developer_controlled_bridge_topup_not_supported');

    vi.unstubAllEnvs();
  });

  it('defaults to the agent wallet provider when the flag is unset', async () => {
    const executor = {} as CircleAgentCliExecutor;
    const withConnectedExecutor = vi.fn((
      _input: { readonly orgId: string },
      operation: (scopedExecutor: CircleAgentCliExecutor) => Promise<unknown>,
    ) => operation(executor));
    const service = { withConnectedExecutor } as unknown as CircleConnectionService;
    const provider = createOrgScopedCircleTreasuryProvider(service, 'org_1');

    // The Agent Wallet path routes through the connected executor -- proof
    // it isn't silently using the developer-controlled stub.
    await provider.bridgeWalletTopUp({
      amount: '1.00',
      fromAddress: '0x0000000000000000000000000000000000000001',
      fromChain: 'arc',
      mode: 'test',
      toAddress: '0x0000000000000000000000000000000000000002',
      toChain: 'base',
    }).catch(() => undefined);

    expect(withConnectedExecutor).toHaveBeenCalledWith({ orgId: 'org_1' }, expect.any(Function));
  });
});

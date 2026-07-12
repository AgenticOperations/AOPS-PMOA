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
});

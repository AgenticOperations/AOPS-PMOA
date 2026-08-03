import type { CircleConnectionService } from './circle-connection-service.js';
import {
  createCircleAgentWalletTreasuryProvider,
  createDeveloperControlledCircleTreasuryProvider,
  type CircleTreasuryProvider,
} from './circle-provider.js';

export function createOrgScopedCircleTreasuryProvider(
  connectionService: CircleConnectionService,
  orgId: string,
): CircleTreasuryProvider {
  // Mirrors the branch already used by createCircleTreasuryProvider()
  // (circle-provider.ts:1446-1449), so the worker and API process agree on
  // which provider is active. The developer-controlled provider needs no
  // connected executor -- it authenticates with the entity secret, which is
  // precisely why it removes OTP from the loop.
  const developerControlled = process.env.CIRCLE_TREASURY_PROVIDER === 'developer_controlled';

  const invoke = <T>(operation: (provider: CircleTreasuryProvider) => Promise<T>): Promise<T> => (
    developerControlled
      ? operation(createDeveloperControlledCircleTreasuryProvider())
      : connectionService.withConnectedExecutor({ orgId }, async (executor) => (
          operation(createCircleAgentWalletTreasuryProvider({ executor }))
        ))
  );
  const assertOrg = (inputOrgId: string): void => {
    if (inputOrgId !== orgId) throw new Error('circle_connection_org_mismatch');
  };

  return {
    bridgeWalletTopUp: (input) => invoke((provider) => provider.bridgeWalletTopUp(input)),
    createWallet: (input) => {
      assertOrg(input.orgId);
      return invoke((provider) => provider.createWallet(input));
    },
    createWalletSet: (input) => {
      assertOrg(input.orgId);
      return invoke((provider) => provider.createWalletSet(input));
    },
    getGatewayBalance: (input) => invoke((provider) => provider.getGatewayBalance(input)),
    getWalletBalances: (input) => invoke((provider) => provider.getWalletBalances(input)),
    health: (mode) => ({
      configured: mode === 'test',
      missing: mode === 'test' ? [] : ['testnet_only'],
      mode,
      provider: 'circle',
    }),
    initiateGatewayDeposit: (input) => invoke((provider) => provider.initiateGatewayDeposit(input)),
    requestTestnetFunds: (input) => invoke((provider) => provider.requestTestnetFunds(input)),
    settleExactX402: (input) => invoke((provider) => provider.settleExactX402(input)),
    settleGatewayX402: (input) => invoke((provider) => provider.settleGatewayX402(input)),
    transferWallet: (input) => invoke((provider) => provider.transferWallet(input)),
  };
}

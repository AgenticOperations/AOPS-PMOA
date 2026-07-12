import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fundTreasuryOnboardingAction } from '@/app/actions/onboarding';
import { upsertOnboardingState } from '@/lib/server/identity-spine-client';
import { requestTestnetFunds } from '@/lib/server/payments-client';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/server/identity-spine-client', () => ({
  upsertOnboardingState: vi.fn(),
}));
vi.mock('@/lib/server/payments-client', () => ({
  completeCircleConnection: vi.fn(),
  createCircleTreasury: vi.fn(),
  disconnectCircleConnection: vi.fn(),
  initializeCircleConnection: vi.fn(),
  requestTestnetFunds: vi.fn(),
}));

describe('treasury onboarding actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not mark treasury funding complete when every provider job fails', async () => {
    vi.mocked(requestTestnetFunds).mockResolvedValueOnce([
      { chain: 'base', error_code: 'circle_testnet_faucet_rate_limited', status: 'failed' },
      { chain: 'arbitrum', error_code: 'circle_testnet_faucet_rate_limited', status: 'failed' },
    ] as Awaited<ReturnType<typeof requestTestnetFunds>>);

    const result = await fundTreasuryOnboardingAction('org_acme', 'acme', {}, new FormData());

    expect(result).toEqual({
      error: 'Circle testnet funding was not available. Review the failed provider jobs before retrying.',
    });
    expect(upsertOnboardingState).toHaveBeenCalledWith('org_acme', 'treasury_funding', expect.objectContaining({
      status: 'in_progress',
      payload: expect.objectContaining({ failed: ['base', 'arbitrum'], succeeded: [] }),
    }));
  });
});

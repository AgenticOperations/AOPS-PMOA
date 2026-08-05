import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setAgentPaymentAccessAction } from '@/app/actions/payments';
import { setAgentPaymentAccess } from '@/lib/server/payments-client';
import { revalidatePath } from 'next/cache';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/server/payments-client', () => ({
  bridgeExactWalletTopUp: vi.fn(),
  cancelLiquidityJob: vi.fn(),
  createCircleTreasury: vi.fn(),
  createTreasury: vi.fn(),
  initiateGatewayDeposit: vi.fn(),
  reconcileCircleProviderJobs: vi.fn(),
  requestTestnetFunds: vi.fn(),
  retryLiquidityJob: vi.fn(),
  setProviderMode: vi.fn(),
  setAgentPaymentAccess: vi.fn(),
  verifyPaymentRails: vi.fn(),
  verifyPaymentRail: vi.fn(),
}));

function accessForm(rails: readonly string[]): FormData {
  const form = new FormData();
  form.set('agentId', 'agt_1');
  form.set('budget', '5.00');
  form.set('perRequestCap', '2.00');
  form.set('status', 'active');
  for (const rail of rails) form.append('allowedRails', rail);
  return form;
}

describe('setAgentPaymentAccessAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards Arc rails instead of silently dropping them', async () => {
    // railFields FILTERS rather than throws, so a rail missing from the
    // allowlist produced a successful save whose payload never contained it.
    // The operator saw the checkbox come back empty with no error anywhere.
    await setAgentPaymentAccessAction('org_1', 'acme', accessForm(['exact_arc', 'gateway_arc']));

    expect(setAgentPaymentAccess).toHaveBeenCalledWith(
      'org_1',
      'agt_1',
      expect.objectContaining({ allowed_rails: ['exact_arc', 'gateway_arc'] }),
    );
  });

  it('still rejects a rail that is not a real payment rail', async () => {
    await setAgentPaymentAccessAction('org_1', 'acme', accessForm(['exact_arc', 'exact_dogecoin']));

    expect(setAgentPaymentAccess).toHaveBeenCalledWith(
      'org_1',
      'agt_1',
      expect.objectContaining({ allowed_rails: ['exact_arc'] }),
    );
  });

  it('revalidates the nested payment panels, not just the payments index', async () => {
    // Every panel an operator edits lives under /payments/*. Revalidating the
    // bare path leaves them serving stale props, so a correct save appears to
    // have been lost when the panel is reopened.
    await setAgentPaymentAccessAction('org_1', 'acme', accessForm(['exact_arc']));

    expect(revalidatePath).toHaveBeenCalledWith('/app/acme/payments', 'layout');
  });
});

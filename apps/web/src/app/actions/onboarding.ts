'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { upsertOnboardingState } from '@/lib/server/identity-spine-client';
import {
  completeCircleConnection,
  createCircleTreasury,
  disconnectCircleConnection,
  initializeCircleConnection,
  requestTestnetFunds,
} from '@/lib/server/payments-client';

export type CircleOnboardingActionState = {
  readonly challengeId?: string | undefined;
  readonly email?: string | undefined;
  readonly error?: string | undefined;
  readonly message?: string | undefined;
};

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function onboardingPath(orgSlug: string): string {
  return `/onboarding/${orgSlug}`;
}

async function syncTreasury(orgId: string): Promise<void> {
  await createCircleTreasury(orgId, { label: 'Testnet Circle Agent Wallet' });
  await upsertOnboardingState(orgId, 'circle_wallet_sync', {
    status: 'completed',
    payload: { mode: 'test', source: 'circle_agent_wallet' },
  });
}

export async function startCircleConnectionAction(
  orgId: string,
  _previousState: CircleOnboardingActionState,
  formData: FormData,
): Promise<CircleOnboardingActionState> {
  try {
    const result = await initializeCircleConnection(orgId, { email: stringField(formData, 'email') });
    await upsertOnboardingState(orgId, 'circle_wallet_sync', {
      status: 'in_progress',
      payload: { mode: 'test', stage: 'otp_pending' },
    });
    return { challengeId: result.challengeId, email: result.email };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Circle verification could not be started.' };
  }
}

export async function completeCircleConnectionAction(
  orgId: string,
  orgSlug: string,
  _previousState: CircleOnboardingActionState,
  formData: FormData,
): Promise<CircleOnboardingActionState> {
  try {
    await completeCircleConnection(orgId, {
      challenge_id: stringField(formData, 'challengeId'),
      otp: stringField(formData, 'otp'),
    });
    await syncTreasury(orgId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Circle verification could not be completed.' };
  }
  revalidatePath(onboardingPath(orgSlug));
  redirect(onboardingPath(orgSlug));
}

export async function syncTreasuryOnboardingAction(orgId: string, orgSlug: string): Promise<void> {
  await syncTreasury(orgId);
  revalidatePath(onboardingPath(orgSlug));
}

export async function disconnectCircleConnectionAction(orgId: string, orgSlug: string): Promise<void> {
  await disconnectCircleConnection(orgId);
  await upsertOnboardingState(orgId, 'circle_wallet_sync', {
    status: 'not_started',
    payload: { disconnected: true, mode: 'test' },
  });
  revalidatePath(onboardingPath(orgSlug));
}

export async function fundTreasuryOnboardingAction(
  orgId: string,
  orgSlug: string,
  _previousState: CircleOnboardingActionState,
  _formData: FormData,
): Promise<CircleOnboardingActionState> {
  try {
    const jobs = await requestTestnetFunds(orgId, {
      chains: ['base', 'arbitrum', 'polygon', 'optimism', 'avalanche'],
    });
    const succeeded = jobs.filter((job) => job.status === 'complete').map((job) => job.chain);
    const failed = jobs.filter((job) => job.status === 'failed').map((job) => job.chain);
    await upsertOnboardingState(orgId, 'treasury_funding', {
      status: failed.length === 0 ? 'completed' : 'in_progress',
      payload: { failed, mode: 'test', source: 'circle_faucet', succeeded },
    });
    revalidatePath(onboardingPath(orgSlug));
    if (succeeded.length === 0) {
      return { error: 'Circle testnet funding was not available. Review the failed provider jobs before retrying.' };
    }
    if (failed.length > 0) {
      return { message: `Testnet USDC was requested for ${succeeded.length} of ${jobs.length} chains. Review the remaining provider jobs before retrying.` };
    }
    return { message: 'Testnet USDC was requested for all five treasury wallets.' };
  } catch (error) {
    await upsertOnboardingState(orgId, 'treasury_funding', {
      status: 'in_progress',
      payload: { failed: true, mode: 'test', source: 'circle_faucet' },
    });
    revalidatePath(onboardingPath(orgSlug));
    return { error: error instanceof Error ? error.message : 'Circle testnet funding could not be requested.' };
  }
}

export async function skipTreasuryOnboardingAction(orgId: string, orgSlug: string): Promise<void> {
  await upsertOnboardingState(orgId, 'circle_wallet_sync', {
    status: 'completed',
    payload: { skipped: true },
  });
  redirect(`/app/${orgSlug}/overview`);
}

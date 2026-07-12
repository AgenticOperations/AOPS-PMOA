import { redirect } from 'next/navigation';
import {
  completeCircleConnectionAction,
  disconnectCircleConnectionAction,
  fundTreasuryOnboardingAction,
  skipTreasuryOnboardingAction,
  startCircleConnectionAction,
  syncTreasuryOnboardingAction,
} from '@/app/actions/onboarding';
import { AuthEntryShell } from '@/components/AuthEntryShell';
import { CircleTreasuryOnboarding } from '@/components/onboarding/CircleTreasuryOnboarding';
import { getCurrentSession, getOrgBySlug } from '@/lib/server/identity-spine-client';
import { getCircleConnection, listCircleWallets } from '@/lib/server/payments-client';

export const dynamic = 'force-dynamic';

type TreasuryOnboardingPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export default async function TreasuryOnboardingPage({ params }: TreasuryOnboardingPageProps) {
  const session = await getCurrentSession();
  if (session === null) redirect('/auth');
  const { orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }
  const connection = await getCircleConnection(org.id);
  const wallets = connection.status === 'connected' ? await listCircleWallets(org.id) : [];

  return (
    <AuthEntryShell
      activeStep={3}
      description="Connect the organization-owned Circle Agent Wallet and prepare the testnet treasury. You can skip this and resume later."
      eyebrow="Treasury setup"
      title="Connect your treasury"
    >
      <CircleTreasuryOnboarding
        completeAction={completeCircleConnectionAction.bind(null, org.id, org.slug)}
        connection={connection}
        defaultEmail={session.user.email}
        disconnectAction={disconnectCircleConnectionAction.bind(null, org.id, org.slug)}
        fundAction={fundTreasuryOnboardingAction.bind(null, org.id, org.slug)}
        orgSlug={org.slug}
        skipAction={skipTreasuryOnboardingAction.bind(null, org.id, org.slug)}
        startAction={startCircleConnectionAction.bind(null, org.id)}
        syncAction={syncTreasuryOnboardingAction.bind(null, org.id, org.slug)}
        walletCount={wallets.filter((wallet) => wallet.status === 'active').length}
      />
    </AuthEntryShell>
  );
}

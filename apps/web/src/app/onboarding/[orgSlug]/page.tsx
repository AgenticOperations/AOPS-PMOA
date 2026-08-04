import { redirect } from 'next/navigation';
import { provisionTreasuryAction } from '@/app/actions/onboarding';
import { AuthEntryShell } from '@/components/AuthEntryShell';
import { WalletOnboarding } from '@/components/onboarding/WalletOnboarding';
import { WalletProvider } from '@/components/wallet/WalletProvider';
import { getCurrentSession, getOrgBySlug } from '@/lib/server/identity-spine-client';
import { listCircleWallets } from '@/lib/server/payments-client';

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

  // A workspace with no wallet set yet simply has none to list; that is the
  // pre-provision state, not an error.
  const wallets = await listCircleWallets(org.id).catch(() => []);
  const treasuryReady = wallets.some((wallet) => wallet.status === 'active');

  return (
    <AuthEntryShell
      activeStep={3}
      description="Prepare your workspace, then connect the wallet your agents will spend from. Your funds stay in your wallet."
      eyebrow="Workspace setup"
      title="Connect your wallet"
    >
      <WalletProvider>
        <WalletOnboarding
          orgSlug={org.slug}
          provisionAction={provisionTreasuryAction.bind(null, org.id, org.slug)}
          treasuryReady={treasuryReady}
        />
      </WalletProvider>
    </AuthEntryShell>
  );
}

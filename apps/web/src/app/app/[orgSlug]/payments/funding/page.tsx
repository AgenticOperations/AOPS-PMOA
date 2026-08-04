import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { FundingHierarchy } from '@/components/payments/FundingHierarchy';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
import { listAgentWalletFunding, listCircleWallets } from '@/lib/server/payments-client';

export const dynamic = 'force-dynamic';

type FundingPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export default async function PaymentsFundingPage({ params }: FundingPageProps) {
  const { orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  // A workspace with no treasury or no agents yet simply has empty lists --
  // that is the starting state, not an error worth failing the page over.
  const [treasuryWallets, agentWallets] = await Promise.all([
    listCircleWallets(org.id).catch(() => []),
    listAgentWalletFunding(org.id).catch(() => []),
  ]);

  return (
    <ConsoleShell active="payments" org={org}>
      <div className="grid gap-6">
        <header>
          <h1 className="text-lg font-medium">Funding</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Where money enters, where it sits, and who spends it.
          </p>
        </header>
        <FundingHierarchy agentWallets={agentWallets} treasuryWallets={treasuryWallets} />
      </div>
    </ConsoleShell>
  );
}

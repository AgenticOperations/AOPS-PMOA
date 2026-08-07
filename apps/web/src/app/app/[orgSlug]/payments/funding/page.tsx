import { redirect } from 'next/navigation';
import Link from 'next/link';
import { FundingHierarchy } from '@/components/payments/FundingHierarchy';
import { TreasuryWorkbench } from '@/components/payments/TreasuryChrome';
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

  const [treasuryWallets, agentWallets] = await Promise.all([
    listCircleWallets(org.id).catch(() => []),
    listAgentWalletFunding(org.id).catch(() => []),
  ]);

  return (
      <TreasuryWorkbench
        active="fund"
        description="Pick one path: deposit to the org treasury, or grant from your wallet."
        info={
          <>
            <Link href={`/app/${org.slug}/payments/sources`}>Networks</Link>
            {' · '}
            <Link href={`/app/${org.slug}/payments/liquidity`}>Liquidity</Link>
          </>
        }
        orgSlug={org.slug}
        title="Fund"
      >
        <FundingHierarchy
          agentWallets={agentWallets}
          orgSlug={org.slug}
          treasuryWallets={treasuryWallets}
        />
      </TreasuryWorkbench>
  );
}

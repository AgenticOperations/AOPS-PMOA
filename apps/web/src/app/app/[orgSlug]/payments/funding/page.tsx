import { redirect } from 'next/navigation';
import Link from 'next/link';
import { FundingHierarchy } from '@/components/payments/FundingHierarchy';
import { OrgCeilingForm } from '@/components/payments/OrgCeilingForm';
import { TreasuryWorkbench } from '@/components/payments/TreasuryChrome';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
import { listAgentWalletFunding, listCircleWallets, listOrgCeilings } from '@/lib/server/payments-client';

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

  const [treasuryWallets, agentWallets, ceilings] = await Promise.all([
    listCircleWallets(org.id).catch(() => []),
    listAgentWalletFunding(org.id).catch(() => []),
    listOrgCeilings(org.id).catch(() => []),
  ]);

  return (
      <TreasuryWorkbench
        active="fund"
        description="Set org ceilings, deposit to the treasury, or open an agent to grant spend and graduate escrow trust."
        info={
          <>
            <Link href={`/app/${org.slug}/payments/sources`}>Networks</Link>
            {' · '}
            <Link href={`/app/${org.slug}/payments/liquidity`}>Liquidity</Link>
            {' · '}
            <Link href={`/app/${org.slug}/agents`}>Agents → Spend</Link>
          </>
        }
        orgSlug={org.slug}
        title="Fund"
      >
        <OrgCeilingForm ceilings={ceilings} orgSlug={org.slug} />
        <FundingHierarchy
          agentWallets={agentWallets}
          orgSlug={org.slug}
          treasuryWallets={treasuryWallets}
        />
      </TreasuryWorkbench>
  );
}

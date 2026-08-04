import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { WalletProvider } from '@/components/wallet/WalletProvider';
import { DelegateToAgent } from '@/components/wallet/DelegateToAgent';
import { DelegationList } from '@/components/wallet/DelegationList';
import { getOrgBySlug, listAgents } from '@/lib/server/identity-spine-client';
import { listDelegations } from '@/lib/server/payments-client';

export const dynamic = 'force-dynamic';

type DelegationsPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export default async function PaymentsDelegationsPage({ params }: DelegationsPageProps) {
  const { orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [agents, delegations] = await Promise.all([
    listAgents(org.id),
    // A brand-new org has no delegations and the API may not be reachable in
    // every environment -- an empty list is a fine starting state, and the
    // connect/delegate flow below still works.
    listDelegations(org.id).catch(() => []),
  ]);

  return (
    <ConsoleShell active="payments" org={org}>
      <div className="grid gap-6">
        <header>
          <h1 className="text-lg font-medium">Spending delegations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your wallet holds the funds. Each agent draws only against the cap you sign for, and
            never more.
          </p>
        </header>

        <WalletProvider>
          <DelegateToAgent
            agents={agents.map((agent) => ({ id: agent.id, name: agent.name }))}
            orgSlug={org.slug}
          />
        </WalletProvider>

        <DelegationList delegations={delegations} orgSlug={org.slug} />
      </div>
    </ConsoleShell>
  );
}

import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { DelegateFromTreasury } from '@/components/payments/DelegateFromTreasury';
import { OrgCeilingForm } from '@/components/payments/OrgCeilingForm';
import { DelegationList } from '@/components/wallet/DelegationList';
import { getOrgBySlug, listAgents } from '@/lib/server/identity-spine-client';
import { listDelegations, listOrgCeilings } from '@/lib/server/payments-client';

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

  const [agents, delegations, ceilings] = await Promise.all([
    listAgents(org.id),
    // A brand-new org has no delegations and the API may not be reachable in
    // every environment -- an empty list is a fine starting state, and the
    // delegate flow below still works.
    listDelegations(org.id).catch(() => []),
    listOrgCeilings(org.id).catch(() => []),
  ]);

  return (
    <ConsoleShell active="payments" org={org}>
      <div className="grid gap-6">
        <header>
          <h1 className="text-lg font-medium">Spending delegations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Agents draw from the org treasury, each capped at what you set here, all bounded by the
            org ceiling.
          </p>
          {/*
            Said plainly rather than left to be discovered: the treasury is
            custodial. These caps bound what a compromised or misbehaving
            AGENT can take -- not what a compromised platform could.
          */}
          <p className="mt-2 text-xs text-muted-foreground">
            The treasury is held by this platform. These caps limit what an agent can spend; they
            are not protection against the platform itself.
          </p>
        </header>

        <OrgCeilingForm ceilings={ceilings} orgSlug={org.slug} />

        <DelegateFromTreasury
          agents={agents.map((agent) => ({ id: agent.id, name: agent.name }))}
          orgSlug={org.slug}
        />

        <DelegationList delegations={delegations} orgSlug={org.slug} />
      </div>
    </ConsoleShell>
  );
}

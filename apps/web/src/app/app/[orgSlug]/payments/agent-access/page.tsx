import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { TreasuryAgentAccess } from '@/components/payments/TreasuryAgentAccess';
import { setAgentPaymentAccessAction } from '@/app/actions/payments';
import { getOrgBySlug, listAgents } from '@/lib/server/identity-spine-client';
import { listAgentPaymentAccounts, listPaymentCapabilities } from '@/lib/server/payments-client';

export const dynamic = 'force-dynamic';

type AgentAccessPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export default async function PaymentsAgentAccessPage({ params }: AgentAccessPageProps) {
  const { orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [agents, agentAccounts, capabilities] = await Promise.all([
    listAgents(org.id),
    listAgentPaymentAccounts(org.id),
    listPaymentCapabilities(org.id),
  ]);

  return (
    <ConsoleShell active="payments" org={org}>
      <TreasuryAgentAccess
        accessAction={setAgentPaymentAccessAction.bind(null, org.id, org.slug)}
        accounts={agentAccounts.accounts}
        agents={agents}
        capabilities={capabilities}
        orgSlug={org.slug}
      />
    </ConsoleShell>
  );
}

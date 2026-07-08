import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { OperationsWorkbench } from '@/components/operations/OperationsWorkbench';
import { createOperationLimitAction, importToolAction } from '@/app/actions/operations';
import { listAgents, getOrgBySlug } from '@/lib/server/identity-spine-client';
import { listBlockedOperations, listTools } from '@/lib/server/operations-client';

export const dynamic = 'force-dynamic';

type OperationsPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export default async function OperationsPage({ params }: OperationsPageProps) {
  const { orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [agents, blocked, tools] = await Promise.all([
    listAgents(org.id),
    listBlockedOperations(org.id, { limit: 50 }),
    listTools(org.id),
  ]);

  return (
    <ConsoleShell active="operations" org={org}>
      <OperationsWorkbench
        agents={agents.map((agent) => ({ id: agent.id, name: agent.name }))}
        blocked={blocked}
        importAction={importToolAction.bind(null, org.id, org.slug)}
        rateLimitAction={createOperationLimitAction.bind(null, org.id, org.slug)}
        tools={tools}
      />
    </ConsoleShell>
  );
}

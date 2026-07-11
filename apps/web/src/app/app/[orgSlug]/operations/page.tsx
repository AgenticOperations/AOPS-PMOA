import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { OrgAuditPanel } from '@/components/audit/OrgAuditPanel';
import { OperationsWorkbench } from '@/components/operations/OperationsWorkbench';
import {
  archiveToolAction,
  createOperationLimitAction,
  disableOperationLimitAction,
  importToolAction,
  updateOperationLimitAction,
  updateToolAction,
} from '@/app/actions/operations';
import { listAgents, getOrgBySlug } from '@/lib/server/identity-spine-client';
import { listAuditEvents } from '@/lib/server/audit-client';
import { listBlockedOperations, listRateLimits, listTools } from '@/lib/server/operations-client';

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

  const [agents, blocked, tools, rateLimits, auditEvents] = await Promise.all([
    listAgents(org.id),
    listBlockedOperations(org.id, { limit: 50 }),
    listTools(org.id),
    listRateLimits(org.id),
    listAuditEvents(org.id, 30),
  ]);

  return (
    <ConsoleShell active="operations" org={org}>
      <OperationsWorkbench
        agents={agents.map((agent) => ({ id: agent.id, name: agent.name }))}
        archiveToolAction={archiveToolAction.bind(null, org.id, org.slug)}
        blocked={blocked}
        disableRateLimitAction={disableOperationLimitAction.bind(null, org.id, org.slug)}
        importAction={importToolAction.bind(null, org.id, org.slug)}
        rateLimits={rateLimits}
        rateLimitAction={createOperationLimitAction.bind(null, org.id, org.slug)}
        tools={tools}
        updateRateLimitAction={updateOperationLimitAction.bind(null, org.id, org.slug)}
        updateToolAction={updateToolAction.bind(null, org.id, org.slug)}
      />
      <OrgAuditPanel
        description="Tool catalog changes, runtime operation checks, rate-limit decisions, and blocked actions from the audit stream."
        domains={['system', 'policy']}
        events={auditEvents.events}
        title="Operations activity"
      />
    </ConsoleShell>
  );
}

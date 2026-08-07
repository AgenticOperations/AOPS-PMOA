import { redirect } from 'next/navigation';
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
import {
  listOperationDecisions,
  listRateLimits,
  listTools,
} from '@/lib/server/operations-client';

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

  const [agents, decisions, tools, rateLimits] = await Promise.all([
    listAgents(org.id),
    listOperationDecisions(org.id, { limit: 100 }),
    listTools(org.id),
    listRateLimits(org.id),
  ]);
  const activeAgents = agents.filter((agent) => agent.status !== 'deactivated');

  return (
      <OperationsWorkbench
        agents={activeAgents.map((agent) => ({ id: agent.id, name: agent.name }))}
        archiveToolAction={archiveToolAction.bind(null, org.id, org.slug)}
        decisions={decisions}
        disableRateLimitAction={disableOperationLimitAction.bind(null, org.id, org.slug)}
        importAction={importToolAction.bind(null, org.id, org.slug)}
        rateLimits={rateLimits}
        rateLimitAction={createOperationLimitAction.bind(null, org.id, org.slug)}
        tools={tools}
        updateRateLimitAction={updateOperationLimitAction.bind(null, org.id, org.slug)}
        updateToolAction={updateToolAction.bind(null, org.id, org.slug)}
      />
  );
}

import { redirect } from 'next/navigation';
import { createJoinInviteAction, revokeJoinInviteAction } from '@/app/actions/agent-join';
import { JoinInviteCreateDrawer } from '@/components/agents/JoinInviteCreateDrawer';
import { JoinInviteTable } from '@/components/agents/JoinInviteTable';
import { getOrgBySlug, listAgentJoinInvites } from '@/lib/server/identity-spine-client';

export const dynamic = 'force-dynamic';

type JoinInvitesPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export default async function JoinInvitesPage({ params }: JoinInvitesPageProps) {
  const { orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const invites = await listAgentJoinInvites(org.id);

  return (
    <main className="registry-page" id="main-content">
      <header className="registry-page-header">
        <div>
          <p className="registry-eyebrow">Identity / agents</p>
          <h1>Join invites</h1>
          <p className="registry-page-copy">
            Issue a one-time (or multi-use) sandbox token. Give it to an agent so it can redeem an MCP
            credential. Payment access stays off until you enable it.
          </p>
        </div>
        <JoinInviteCreateDrawer action={createJoinInviteAction.bind(null, org.id, org.slug)} />
      </header>

      <JoinInviteTable
        invites={invites}
        revokeAction={revokeJoinInviteAction.bind(null, org.id, org.slug)}
      />
    </main>
  );
}

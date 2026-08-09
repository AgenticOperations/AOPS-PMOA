import Link from 'next/link';
import { AgenticChatWorkspace } from '@/components/chat/AgenticChatWorkspace';
import { getCurrentSession, listOrgs } from '@/lib/server/identity-spine-client';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export default async function ChatPage() {
  const session = await getCurrentSession().catch(() => null);
  if (session === null) {
    return (
      <section className="achat-gate" aria-labelledby="achat-gate-title">
        <div className="achat-gate-inner">
          <p className="achat-eyebrow">AgentOps</p>
          <h1 id="achat-gate-title">Chat with agent</h1>
          <p>
            Sign in to ask in natural language — create agents, check funding, hire marketplace services, or run a fleet
            under org policy.
          </p>
          <div className="achat-gate-actions">
            <Link className="achat-primary" href="/auth">
              Sign in to chat
            </Link>
            <Link className="achat-secondary" href="/marketplace">
              Browse marketplace
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const orgs = await listOrgs().catch(() => []);
  const org = orgs[0];
  if (org === undefined) {
    return (
      <section className="achat-gate" aria-labelledby="achat-gate-title">
        <div className="achat-gate-inner">
          <p className="achat-eyebrow">AgentOps</p>
          <h1 id="achat-gate-title">Create an org first</h1>
          <p>Chat with agent uses your primary org’s agents, treasury, and policies.</p>
          <div className="achat-gate-actions">
            <Link className="achat-primary" href="/onboarding">
              Finish onboarding
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return <AgenticChatWorkspace orgId={org.id} orgSlug={org.slug} />;
}

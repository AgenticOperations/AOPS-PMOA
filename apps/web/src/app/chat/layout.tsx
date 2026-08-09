import type { ReactNode } from 'react';
import { MarketplacePublicNav } from '@/components/marketplace/MarketplacePublicNav';
import { getCurrentSession, listOrgs } from '@/lib/server/identity-spine-client';

export const metadata = {
  title: 'Chat with agent — agentOps',
  description: 'Ask in natural language. Your org agents fulfill the work under AgentOps policy.',
};

export default async function ChatLayout({ children }: { readonly children: ReactNode }) {
  const session = await getCurrentSession().catch(() => null);
  const orgs = session === null ? [] : await listOrgs().catch(() => []);
  const primaryOrg = orgs[0];
  const dashboardHref = primaryOrg === undefined ? null : `/app/${primaryOrg.slug}/overview`;

  return (
    <div className="amkt achat">
      <div className="achat-sky" aria-hidden="true">
        <div className="achat-sky-media" />
        <div className="achat-sky-fade" />
      </div>
      <MarketplacePublicNav active="chat" dashboardHref={dashboardHref} />
      {children}
    </div>
  );
}

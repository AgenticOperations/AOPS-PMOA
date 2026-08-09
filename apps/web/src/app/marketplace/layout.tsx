import type { ReactNode } from 'react';
import { MarketplacePublicNav } from '@/components/marketplace/MarketplacePublicNav';
import { getCurrentSession, listOrgs } from '@/lib/server/identity-spine-client';

export const metadata = {
  title: 'Marketplace — agentOps',
  description: 'Discover hireable agents and services with on-chain identity, reputation, and settlement activity.',
};

export default async function MarketplaceLayout({ children }: { readonly children: ReactNode }) {
  const session = await getCurrentSession().catch(() => null);
  const orgs = session === null ? [] : await listOrgs().catch(() => []);
  const primaryOrg = orgs[0];
  const dashboardHref = primaryOrg === undefined ? null : `/app/${primaryOrg.slug}/overview`;

  return (
    <div className="amkt">
      <MarketplacePublicNav dashboardHref={dashboardHref} />
      {children}
    </div>
  );
}

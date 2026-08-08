import type { ReactNode } from 'react';
import { MarketplacePublicNav } from '@/components/marketplace/MarketplacePublicNav';
import './marketplace.css';

export const metadata = {
  title: 'Marketplace — agentOps',
  description: 'Discover hireable agents and services with on-chain identity, reputation, and settlement activity.',
};

export default function MarketplaceLayout({ children }: { readonly children: ReactNode }) {
  return (
    <div className="amkt">
      <MarketplacePublicNav />
      {children}
    </div>
  );
}

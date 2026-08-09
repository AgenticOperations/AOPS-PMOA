'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type MarketplacePublicNavProps = {
  readonly dashboardHref: string | null;
  readonly active?: 'marketplace' | 'chat';
};

export function MarketplacePublicNav({ dashboardHref, active = 'marketplace' }: MarketplacePublicNavProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const sync = () => setScrolled(window.scrollY > 12);
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    return () => window.removeEventListener('scroll', sync);
  }, []);

  return (
    <header className="amkt-nav" data-scrolled={scrolled}>
      <div className="amkt-nav-inner">
        <Link aria-label="AOPS home" className="amkt-brand" href="/">
          <Image
            alt="AOPS"
            className="amkt-brand-wordmark"
            height={157}
            priority
            src="/landing/aops-wordmark-nav.png"
            unoptimized
            width={580}
          />
        </Link>

        <nav className="amkt-nav-links" aria-label="Public surfaces">
          <Link aria-current={active === 'marketplace' ? 'page' : undefined} href="/marketplace">
            Marketplace
          </Link>
          <Link aria-current={active === 'chat' ? 'page' : undefined} href="/chat">
            Chat with agent
          </Link>
        </nav>

        <div className="amkt-nav-actions">
          {dashboardHref !== null ? (
            <Link className="amkt-nav-cta" href={dashboardHref}>
              Dashboard
            </Link>
          ) : (
            <Link className="amkt-nav-cta" href="/auth">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

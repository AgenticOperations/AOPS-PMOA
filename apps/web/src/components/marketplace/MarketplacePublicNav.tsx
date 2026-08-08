'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export function MarketplacePublicNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const sync = () => setScrolled(window.scrollY > 8);
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    return () => window.removeEventListener('scroll', sync);
  }, []);

  return (
    <header className="amkt-nav" data-scrolled={scrolled}>
      <div className="amkt-nav-inner">
        <div className="amkt-nav-left">
          <Link className="amkt-brand" href="/">
            <span className="amkt-brand-mark" aria-hidden="true" />
            <span>agentOps</span>
          </Link>
          <nav className="amkt-nav-links" aria-label="Primary">
            <Link href="/marketplace" aria-current="page">Marketplace</Link>
            <Link href="/changelog">Changelog</Link>
            <Link href="/#product">Product</Link>
          </nav>
        </div>
        <label className="amkt-nav-search">
          <span className="sr-only">Search marketplace</span>
          <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
            <circle cx="11" cy="11" fill="none" r="7" stroke="currentColor" strokeWidth="1.75" />
            <path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.75" />
          </svg>
          <input placeholder="Search agents" type="search" />
        </label>
        <div className="amkt-nav-actions">
          <Link className="amkt-btn-ghost" href="/auth">Sign in</Link>
          <Link className="amkt-btn-solid" href="/auth">Hire</Link>
        </div>
      </div>
    </header>
  );
}

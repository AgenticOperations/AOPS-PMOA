'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const navigation = [
  { href: '#product', label: 'Product' },
  { href: '#security', label: 'Security' },
  { href: '#developers', label: 'Developers' },
] as const;

export function LandingNavigation() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const sync = () => setScrolled(window.scrollY > 24);
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    return () => window.removeEventListener('scroll', sync);
  }, []);

  return (
    <>
      <header className="aops-nav" data-scrolled={scrolled}>
        <div className="aops-nav-inner">
          <a className="aops-brand" href="#top" aria-label="AOPS home">
            <Image alt="" height={157} priority src="/landing/aops-wordmark-nav.png" unoptimized width={580} />
          </a>
          <nav className="aops-nav-links" aria-label="Primary navigation">
            {navigation.map((item) => (
              <a href={item.href} key={item.href}>{item.label}</a>
            ))}
          </nav>
          <div className="aops-nav-actions">
            <Link href="/auth">Sign in</Link>
            <button
              aria-controls="aops-mobile-menu"
              aria-expanded={open}
              aria-label={open ? 'Close menu' : 'Open menu'}
              className="aops-menu-button"
              onClick={() => setOpen((current) => !current)}
              type="button"
            >
              <span />
              <span />
            </button>
          </div>
        </div>
      </header>
      <nav
        aria-label="Mobile navigation"
        className="aops-mobile-menu"
        data-open={open}
        id="aops-mobile-menu"
      >
        {navigation.map((item) => (
          <a href={item.href} key={item.href} onClick={() => setOpen(false)}>{item.label}</a>
        ))}
        <Link href="/auth" onClick={() => setOpen(false)}>Sign in</Link>
      </nav>
    </>
  );
}

import type { ReactNode } from 'react';
import Link from 'next/link';

type TreasurySection = 'overview' | 'sources' | 'access' | 'liquidity' | 'activity';

const sections: readonly { readonly key: TreasurySection; readonly label: string; readonly suffix: string }[] = [
  { key: 'overview', label: 'Overview', suffix: '' },
  { key: 'sources', label: 'Sources & Rails', suffix: '/sources' },
  { key: 'access', label: 'Agent Access', suffix: '/agent-access' },
  { key: 'liquidity', label: 'Liquidity', suffix: '/liquidity' },
  { key: 'activity', label: 'Activity & Evidence', suffix: '/activity' },
];

export function TreasurySectionNav({ active, orgSlug }: { readonly active: TreasurySection; readonly orgSlug: string }) {
  const base = `/app/${orgSlug}/payments`;
  return (
    <nav aria-label="Treasury sections" className="treasury-subnav">
      {sections.map((section) => (
        <Link
          aria-current={active === section.key ? 'page' : undefined}
          className={active === section.key ? 'is-active' : undefined}
          href={`${base}${section.suffix}`}
          key={section.key}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}

export function TreasuryPageHeader({
  actions,
  description,
  eyebrow,
  title,
}: {
  readonly actions?: ReactNode;
  readonly description: string;
  readonly eyebrow: string;
  readonly title: string;
}) {
  return (
    <header className="treasury-page-header">
      <div>
        <p className="treasury-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions === undefined ? null : <div className="treasury-header-actions">{actions}</div>}
    </header>
  );
}

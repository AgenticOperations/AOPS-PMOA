import type { ReactNode } from 'react';
import Link from 'next/link';

type TreasurySection = 'fund' | 'empower' | 'activity' | 'networks' | 'liquidity';

/** Advanced-only — Fund / Empower / Activity live in the left sidebar. */
const advancedSections: readonly { readonly key: TreasurySection; readonly label: string; readonly href: string }[] = [
  { key: 'networks', label: 'Networks', href: '/sources' },
  { key: 'liquidity', label: 'Liquidity', href: '/liquidity' },
];

export function TreasurySectionNav({
  active,
  orgSlug,
}: {
  readonly active: TreasurySection;
  readonly orgSlug: string;
  /** @deprecated Primary Fund/Empower/Activity tabs removed — sidebar owns those. */
  readonly showAdvanced?: boolean;
}) {
  const base = `/app/${orgSlug}/payments`;
  return (
    <nav aria-label="Treasury advanced" className="treasury-subnav">
      {advancedSections.map((section) => (
        <Link
          aria-current={active === section.key ? 'page' : undefined}
          className={active === section.key ? 'is-active' : undefined}
          href={`${base}${section.href}`}
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
  readonly description?: string;
  readonly eyebrow: string;
  readonly title: string;
}) {
  return (
    <header className="treasury-page-header">
      <div>
        <p className="treasury-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description === undefined || description.length === 0 ? null : <p>{description}</p>}
      </div>
      {actions === undefined ? null : <div className="treasury-header-actions">{actions}</div>}
    </header>
  );
}

/** Soft one-line callout — same density as Home MCP info bar. */
export function TreasuryInfoCallout({ children }: { readonly children: ReactNode }) {
  return (
    <aside className="treasury-info-callout" role="note">
      <span aria-hidden="true" className="treasury-info-mark">i</span>
      <div className="treasury-info-body">{children}</div>
    </aside>
  );
}

/**
 * Shared Fund / Empower / Activity chrome — header + optional info line.
 * Sidebar owns Fund / Empower / Activity; no duplicate primary subnav here.
 */
export function TreasuryWorkbench({
  actions,
  active,
  children,
  description,
  info,
  orgSlug,
  showAdvancedNav = false,
  title,
}: {
  readonly actions?: ReactNode;
  readonly active: TreasurySection;
  readonly children: ReactNode;
  readonly description?: string;
  readonly info?: ReactNode;
  readonly orgSlug: string;
  readonly showAdvancedNav?: boolean;
  readonly title: string;
}) {
  return (
    <div className="treasury-workbench">
      {showAdvancedNav ? <TreasurySectionNav active={active} orgSlug={orgSlug} /> : null}
      <TreasuryPageHeader
        {...(actions === undefined ? {} : { actions })}
        {...(description === undefined ? {} : { description })}
        eyebrow={`Treasury / ${active}`}
        title={title}
      />
      {info === undefined ? null : <TreasuryInfoCallout>{info}</TreasuryInfoCallout>}
      {children}
    </div>
  );
}

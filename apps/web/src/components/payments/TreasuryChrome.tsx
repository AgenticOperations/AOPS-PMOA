import type { ReactNode } from 'react';
import Link from 'next/link';

type TreasurySection = 'fund' | 'empower' | 'activity' | 'networks' | 'liquidity';

const primarySections: readonly { readonly key: TreasurySection; readonly label: string; readonly href: string }[] = [
  { key: 'fund', label: 'Fund', href: '/funding' },
  { key: 'empower', label: 'Empower', href: '/empower' },
  { key: 'activity', label: 'Activity', href: '/activity' },
];

const advancedSections: readonly { readonly key: TreasurySection; readonly label: string; readonly href: string }[] = [
  { key: 'networks', label: 'Networks', href: '/sources' },
  { key: 'liquidity', label: 'Liquidity', href: '/liquidity' },
];

export function TreasurySectionNav({
  active,
  orgSlug,
  showAdvanced = false,
}: {
  readonly active: TreasurySection;
  readonly orgSlug: string;
  readonly showAdvanced?: boolean;
}) {
  const base = `/app/${orgSlug}/payments`;
  const items = showAdvanced ? [...primarySections, ...advancedSections] : primarySections;
  return (
    <nav aria-label="Treasury sections" className="treasury-subnav">
      {items.map((section) => (
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
 * Shared Fund / Empower / Activity chrome — home-like header + one optional
 * info line. Sidebar already carries Fund/Empower/Activity; page subnav stays
 * as a light local mirror only.
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
      <TreasurySectionNav active={active} orgSlug={orgSlug} showAdvanced={showAdvancedNav} />
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

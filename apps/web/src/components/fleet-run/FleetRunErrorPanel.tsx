'use client';

import {
  LinkedActionMessage,
  agentsListHref,
  empowerAccessHref,
  fundHref,
  type ActionNavLink,
} from '@/components/ui/LinkedActionMessage';

type FleetRunErrorPanelProps = {
  readonly orgSlug: string;
  readonly message: string;
  readonly code?: string | null;
};

function linksForError(orgSlug: string, message: string, code: string | null): readonly ActionNavLink[] {
  const lower = message.toLowerCase();
  const links: ActionNavLink[] = [];

  if (code === 'fleet_agents_missing' || lower.includes('missing fleet agents') || lower.includes('agents')) {
    links.push({ match: 'Agents', href: `${agentsListHref(orgSlug)}?setup=fleet` });
  }
  if (lower.includes('empower') || lower.includes('wallet') || lower.includes('payment access')) {
    links.push({ match: 'Spend', href: empowerAccessHref(orgSlug) });
    links.push({ match: 'Agents', href: empowerAccessHref(orgSlug) });
    links.push({ match: 'Empower', href: empowerAccessHref(orgSlug) });
  }
  if (lower.includes('fund') || lower.includes('treasury')) {
    links.push({ match: 'Fund', href: fundHref(orgSlug) });
  }
  if (links.length === 0) {
    links.push({ match: 'Agents', href: `${agentsListHref(orgSlug)}?setup=fleet` });
  }
  return links;
}

/** Compact warning with inline redirects — keeps chat chrome clean. */
export function FleetRunErrorPanel({ orgSlug, message, code = null }: FleetRunErrorPanelProps) {
  return (
    <LinkedActionMessage
      className="achat-inline-warning"
      links={linksForError(orgSlug, message, code)}
      message={message}
      role="alert"
    />
  );
}

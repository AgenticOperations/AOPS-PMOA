'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

export type ActionNavLink = {
  /** Case-insensitive substring in the message to turn into a link. */
  readonly match: string;
  readonly href: string;
};

type LinkedActionMessageProps = {
  readonly message: string;
  readonly links: readonly ActionNavLink[];
  readonly className?: string | undefined;
  readonly role?: 'alert' | 'status' | undefined;
};

/**
 * Renders a gated-action message and turns known destination words
 * (e.g. "Credentials") into in-console navigation links.
 */
export function LinkedActionMessage({
  message,
  links,
  className,
  role = 'alert',
}: LinkedActionMessageProps) {
  return (
    <p className={className} role={role}>
      {linkify(message, links)}
    </p>
  );
}

function linkify(message: string, links: readonly ActionNavLink[]): ReactNode {
  if (links.length === 0) return message;

  type Hit = { readonly start: number; readonly end: number; readonly href: string; readonly text: string };
  const hits: Hit[] = [];

  for (const link of links) {
    const index = message.toLowerCase().indexOf(link.match.toLowerCase());
    if (index < 0) continue;
    hits.push({
      start: index,
      end: index + link.match.length,
      href: link.href,
      text: message.slice(index, index + link.match.length),
    });
  }

  if (hits.length === 0) return message;
  hits.sort((left, right) => left.start - right.start);

  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const hit of hits) {
    if (hit.start < cursor) continue;
    if (hit.start > cursor) {
      nodes.push(message.slice(cursor, hit.start));
    }
    nodes.push(
      <Link className="action-nav-link" href={hit.href} key={`nav-${key}`}>
        {hit.text}
      </Link>,
    );
    key += 1;
    cursor = hit.end;
  }
  if (cursor < message.length) nodes.push(message.slice(cursor));
  return nodes;
}

export function agentCredentialsHref(orgSlug: string, agentId: string): string {
  return `/app/${orgSlug}/agents/${encodeURIComponent(agentId)}?tab=credentials`;
}

export function agentsListHref(orgSlug: string): string {
  return `/app/${orgSlug}/agents`;
}

export function empowerAccessHref(orgSlug: string): string {
  return `/app/${orgSlug}/payments/empower?tab=access`;
}

export function fundHref(orgSlug: string): string {
  return `/app/${orgSlug}/payments/funding`;
}

export function activityEscrowHref(orgSlug: string): string {
  return `/app/${orgSlug}/payments/activity?tab=escrow`;
}

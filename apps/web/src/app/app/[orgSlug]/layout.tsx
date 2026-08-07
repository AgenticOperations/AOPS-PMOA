import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConsoleShell } from '@/components/ConsoleShell';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';

export const dynamic = 'force-dynamic';

type ConsoleOrgLayoutProps = {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export default async function ConsoleOrgLayout({ children, params }: ConsoleOrgLayoutProps) {
  const { orgSlug } = await params;
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  return <ConsoleShell org={org}>{children}</ConsoleShell>;
}

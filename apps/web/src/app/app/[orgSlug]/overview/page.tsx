import { redirect } from 'next/navigation';
import { OverviewHomeView } from '@/components/home/OverviewHomeView';
import { readWebEnv } from '@/lib/env';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';

export const dynamic = 'force-dynamic';

type OverviewPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export default async function OverviewPage({ params }: OverviewPageProps) {
  const { orgSlug } = await params;
  try {
    await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  return <OverviewHomeView appBaseUrl={readWebEnv().APP_BASE_URL} orgSlug={orgSlug} />;
}

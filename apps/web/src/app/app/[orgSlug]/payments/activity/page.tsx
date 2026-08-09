import { redirect } from 'next/navigation';

type LegacyPaymentsActivityPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
  readonly searchParams?: Promise<Record<string, string | readonly string[] | undefined>>;
};

/** Canonical Activity hub lives at `/app/{org}/activity`. */
export default async function PaymentsActivityRedirectPage({
  params,
  searchParams,
}: LegacyPaymentsActivityPageProps) {
  const { orgSlug } = await params;
  const query = (await searchParams) ?? {};
  const tabValue = typeof query.tab === 'string' ? query.tab : query.tab?.[0];
  const suffix = tabValue !== undefined && tabValue.length > 0 ? `?tab=${encodeURIComponent(tabValue)}` : '';
  redirect(`/app/${orgSlug}/activity${suffix}`);
}

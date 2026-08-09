import { redirect } from 'next/navigation';

type RedirectProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

/** Empower Access/Delegations moved to each agent Overview → Spend. */
export default async function PaymentsEmpowerRedirect({ params }: RedirectProps) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/payments/funding`);
}

import { redirect } from 'next/navigation';

type PaymentsRedirectProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

/** Treasury hub lands on Fund — the old overview is advanced detail. */
export default async function PaymentsIndexRedirect({ params }: PaymentsRedirectProps) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/payments/funding`);
}

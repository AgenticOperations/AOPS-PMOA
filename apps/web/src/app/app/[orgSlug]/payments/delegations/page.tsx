import { redirect } from 'next/navigation';

type RedirectProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export default async function PaymentsDelegationsRedirect({ params }: RedirectProps) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/payments/empower#delegations`);
}

import { redirect } from 'next/navigation';

type RedirectProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

/** Draw allowances are managed per agent on Overview → Spend. */
export default async function PaymentsDelegationsRedirect({ params }: RedirectProps) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/agents`);
}

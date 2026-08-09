import { redirect } from 'next/navigation';

type RedirectProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

/** Per-agent payment access lives on agent Overview → Spend. */
export default async function PaymentsAgentAccessRedirect({ params }: RedirectProps) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/agents`);
}

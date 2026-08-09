import { redirect } from 'next/navigation';

type FleetRunRedirectProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

/**
 * Fleet Run UI retired from the console — Chat with agent covers the same
 * multi-agent goal flow with a better operator experience.
 */
export default async function FleetRunRedirectPage(_props: FleetRunRedirectProps) {
  redirect('/chat');
}

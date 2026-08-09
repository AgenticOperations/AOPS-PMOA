import { redirect } from 'next/navigation';

type JoinInvitesRedirectProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

/**
 * Legacy route — intentionally not in the sidebar.
 * Join invites live in Agents → Add agent → Invite with token.
 */
export default async function JoinInvitesRedirectPage({ params }: JoinInvitesRedirectProps) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/agents`);
}

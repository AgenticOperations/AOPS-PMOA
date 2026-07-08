import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createOrgAction } from '../actions/identity-spine';
import { AuthEntryShell } from '@/components/AuthEntryShell';
import { getCurrentSession } from '@/lib/server/identity-spine-client';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const session = await getCurrentSession();
  if (session === null) redirect('/auth');
  if (session.orgs.length > 0) redirect(`/app/${session.orgs[0]?.slug}/overview`);

  return (
    <AuthEntryShell
      activeStep={2}
      description="Create the workspace that will own your agents and credentials."
      eyebrow="Workspace setup"
      title="Set up your organization"
    >
      <form action={createOrgAction} className="onboarding-form">
        <label>
          <span>Organization name</span>
          <input name="name" placeholder="Acme Agent Ops" required />
        </label>
        <button className="button-primary" type="submit">
          Create organization
        </button>
      </form>

      <Link className="back-link" href="/auth">
        Back to auth
      </Link>
    </AuthEntryShell>
  );
}

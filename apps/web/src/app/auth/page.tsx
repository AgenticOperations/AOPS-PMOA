import Link from 'next/link';
import { AuthEntryShell } from '@/components/AuthEntryShell';
import { getCurrentSession } from '@/lib/server/identity-spine-client';

export const dynamic = 'force-dynamic';

type AuthPageProps = {
  readonly searchParams: Promise<{ readonly error?: string | string[] | undefined }>;
};

function oauthErrorMessage(error: string | string[] | undefined): string | null {
  const code = Array.isArray(error) ? error[0] : error;
  if (code === 'oauth_state') return 'Google sign-in could not be verified. Start again from this page.';
  if (code === 'oauth_exchange') return 'Google sign-in could not be completed. Try again with your work account.';
  return null;
}

function GoogleLogo() {
  return (
    <span aria-hidden="true" className="google-logo" data-testid="google-logo">
      <svg focusable="false" viewBox="0 0 24 24">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.24 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z"
          fill="#EA4335"
        />
      </svg>
    </span>
  );
}

export default async function AuthPage({ searchParams }: AuthPageProps) {
  const session = await getCurrentSession();
  const params = await searchParams;
  const oauthError = oauthErrorMessage(params.error);

  if (session === null) {
    return (
      <AuthEntryShell
        activeStep={1}
        description="Use your work Google account to continue."
        title="Sign in to agentOps"
      >
        {oauthError !== null ? (
          <div className="entry-alert" role="alert">
            <strong>{oauthError}</strong>
            <Link href="/api/auth/google/start">Try Google again</Link>
          </div>
        ) : null}
        <Link className="google-button" href="/api/auth/google/start">
          <GoogleLogo />
          Continue with Google
        </Link>
      </AuthEntryShell>
    );
  }

  if (session.orgs.length === 0) {
    return (
      <AuthEntryShell
        activeStep={2}
        description="Create a workspace for this account, or use Google to continue with another account."
        eyebrow={session.user.email}
        title="Continue setup"
      >
        <Link className="button-primary" href="/onboarding">
          Continue as {session.user.email}
        </Link>
        <Link className="button-secondary" href="/api/auth/google/start">
          <GoogleLogo />
          Continue with Google
        </Link>
      </AuthEntryShell>
    );
  }

  return (
    <AuthEntryShell
      activeStep={2}
      description="Open a workspace linked to this account, or use Google to continue with another account."
      eyebrow={session.user.email}
      title="Continue workspace"
    >
      <div className="workspace-card-list">
        {session.orgs.map((org) => (
          <Link
            aria-label={`Continue to ${org.name}`}
            className="workspace-card-link"
            href={`/app/${org.slug}/overview`}
            key={org.id}
          >
            <strong>Continue to {org.name}</strong>
            <span>{org.slug}</span>
          </Link>
        ))}
      </div>
      <Link className="button-secondary" href="/api/auth/google/start">
        <GoogleLogo />
        Continue with Google
      </Link>
    </AuthEntryShell>
  );
}

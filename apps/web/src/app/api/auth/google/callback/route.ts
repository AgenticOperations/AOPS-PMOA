import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { readWebEnv } from '@/lib/env';
import { exchangeGoogleCode } from '@/lib/server/identity-spine-client';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const env = readWebEnv();
  const appBase = env.APP_BASE_URL.replace(/\/$/, '');
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const cookieStore = await cookies();
  const expectedState = cookieStore.get('agentops_oauth_state')?.value ?? null;

  if (code === null || state === null || expectedState === null || state !== expectedState) {
    return NextResponse.redirect(`${appBase}/auth?error=oauth_state`);
  }

  try {
    const session = await exchangeGoogleCode({
      code,
      redirectUri: `${appBase}/api/auth/google/callback`,
    });
    const response = NextResponse.redirect(`${appBase}/auth`);
    response.cookies.delete('agentops_oauth_state');
    response.cookies.set(env.SESSION_COOKIE_NAME, session.session_token, {
      httpOnly: true,
      expires: new Date(session.expires_at),
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    return response;
  } catch {
    return NextResponse.redirect(`${appBase}/auth?error=oauth_exchange`);
  }
}

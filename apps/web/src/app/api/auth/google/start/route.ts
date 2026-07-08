import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { readWebEnv } from '@/lib/env';
import { getGoogleAuthorizeUrl } from '@/lib/server/identity-spine-client';

export async function GET(): Promise<NextResponse> {
  const env = readWebEnv();
  const state = randomBytes(24).toString('base64url');
  const redirectUri = `${env.APP_BASE_URL.replace(/\/$/, '')}/api/auth/google/callback`;
  const authorizeUrl = await getGoogleAuthorizeUrl({ redirectUri, state });

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set('agentops_oauth_state', state, {
    httpOnly: true,
    maxAge: 60 * 10,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}

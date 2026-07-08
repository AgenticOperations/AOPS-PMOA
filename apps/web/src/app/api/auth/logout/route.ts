import { NextResponse } from 'next/server';
import { readWebEnv } from '@/lib/env';
import { logoutSession } from '@/lib/server/identity-spine-client';

export async function POST(): Promise<NextResponse> {
  const env = readWebEnv();
  try {
    await logoutSession();
  } catch {
    // The browser cookie is still cleared even if the upstream session is already gone.
  }

  const response = NextResponse.redirect(`${env.APP_BASE_URL.replace(/\/$/, '')}/auth`);
  response.cookies.delete(env.SESSION_COOKIE_NAME);
  return response;
}

import { z } from 'zod';
import { badRequest } from '../identity/errors.js';
import type { GoogleOAuthConfig, GoogleProfile } from './types.js';

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
});

const googleProfileSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean(),
  name: z.string().min(1),
  picture: z.string().url().optional(),
});

export async function fetchGoogleProfile(
  config: GoogleOAuthConfig,
  code: string,
  redirectUri: string,
): Promise<GoogleProfile> {
  if (redirectUri !== config.redirectUrl) {
    throw badRequest('redirect_uri_mismatch', 'OAuth redirect URI is not allowed.');
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUrl,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    throw badRequest('google_token_exchange_failed', 'Google sign-in could not be completed.');
  }

  const token = tokenResponseSchema.parse(await tokenResponse.json());
  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { authorization: `Bearer ${token.access_token}` },
  });

  if (!profileResponse.ok) {
    throw badRequest('google_profile_failed', 'Google profile could not be loaded.');
  }

  const profile = googleProfileSchema.parse(await profileResponse.json());
  if (!profile.email_verified) {
    throw badRequest('google_email_unverified', 'Google account email must be verified.');
  }

  return profile;
}

export function buildGoogleAuthorizeUrl(
  config: GoogleOAuthConfig,
  input: { readonly redirectUri: string; readonly state: string },
): string {
  if (input.redirectUri !== config.redirectUrl) {
    throw badRequest('redirect_uri_mismatch', 'OAuth redirect URI is not allowed.');
  }

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', input.state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export type AuthenticatedUser = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly avatar_url: string | null;
};

export type SessionContext = {
  readonly user: AuthenticatedUser;
  readonly sessionId: string;
};

export type GoogleOAuthConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUrl: string;
};

export type GoogleProfile = {
  readonly sub: string;
  readonly email: string;
  readonly email_verified: boolean;
  readonly name: string;
  readonly picture?: string | undefined;
};

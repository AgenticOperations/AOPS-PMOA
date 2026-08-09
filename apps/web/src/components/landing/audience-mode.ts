export type LandingAudience = 'human' | 'agent';

export const AUDIENCE_QUERY = 'audience';

export function parseAudienceParam(value: string | null | undefined): LandingAudience {
  return value === 'agent' ? 'agent' : 'human';
}

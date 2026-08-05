import { NextResponse, type NextRequest } from 'next/server';
import { getChangelogPullRequests } from '@/lib/server/changelog-client';
import type { ChangelogFilters } from '@/lib/changelog-types';

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const state = params.get('state');
    const filters: ChangelogFilters = {
      repo: params.get('repo') ?? undefined,
      state: state === 'open' || state === 'closed' || state === 'all' ? state : undefined,
      limit: params.has('limit') ? Number(params.get('limit')) : undefined,
    };
    return NextResponse.json(await getChangelogPullRequests(filters));
  } catch (error) {
    return NextResponse.json(
      { error: 'changelog_unavailable', message: error instanceof Error ? error.message : 'Pull requests could not be loaded.' },
      { status: 502 },
    );
  }
}

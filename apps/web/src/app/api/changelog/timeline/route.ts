import { NextResponse, type NextRequest } from 'next/server';
import { getChangelogTimeline } from '@/lib/server/changelog-client';
import type { ChangelogFilters } from '@/lib/changelog-types';

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const filters: ChangelogFilters = {
      repo: params.get('repo') ?? undefined,
      since: params.get('since') ?? undefined,
      until: params.get('until') ?? undefined,
      limit: params.has('limit') ? Number(params.get('limit')) : undefined,
    };
    return NextResponse.json(await getChangelogTimeline(filters));
  } catch (error) {
    return NextResponse.json(
      { error: 'changelog_unavailable', message: error instanceof Error ? error.message : 'Timeline could not be loaded.' },
      { status: 502 },
    );
  }
}

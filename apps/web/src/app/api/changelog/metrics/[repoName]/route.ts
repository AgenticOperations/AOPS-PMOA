import { NextResponse, type NextRequest } from 'next/server';
import { getChangelogMetrics } from '@/lib/server/changelog-client';

type RouteContext = {
  readonly params: Promise<{ readonly repoName: string }>;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { repoName } = await params;
  try {
    const metrics = await getChangelogMetrics(repoName);
    if (metrics === null) {
      return NextResponse.json({ error: 'not_found', message: `No metrics for repository "${repoName}".` }, { status: 404 });
    }
    return NextResponse.json({ data: metrics });
  } catch (error) {
    return NextResponse.json(
      { error: 'changelog_unavailable', message: error instanceof Error ? error.message : 'Metrics could not be loaded.' },
      { status: 502 },
    );
  }
}

import { NextResponse, type NextRequest } from 'next/server';
import { getAgentActivityFeed, getOrgBySlug } from '@/lib/server/identity-spine-client';

type ActivityRouteContext = {
  readonly params: Promise<{ readonly agentId: string; readonly orgSlug: string }>;
};

export async function GET(request: NextRequest, { params }: ActivityRouteContext) {
  const { agentId, orgSlug } = await params;
  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = limitParam === null ? 80 : Number(limitParam);

  try {
    const org = await getOrgBySlug(orgSlug);
    const feed = await getAgentActivityFeed(org.id, agentId, Number.isFinite(limit) ? limit : 80);
    return NextResponse.json(feed);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'activity_feed_unavailable',
        message: error instanceof Error ? error.message : 'Agent activity feed could not be loaded.',
      },
      { status: 500 },
    );
  }
}

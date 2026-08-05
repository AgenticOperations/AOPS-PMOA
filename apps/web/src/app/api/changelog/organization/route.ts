import { NextResponse, type NextRequest } from 'next/server';
import { getChangelogOrganization } from '@/lib/server/changelog-client';

export async function GET(request: NextRequest) {
  try {
    const repo = request.nextUrl.searchParams.get('repo') ?? undefined;
    return NextResponse.json({ data: await getChangelogOrganization(repo) });
  } catch (error) {
    return NextResponse.json(
      { error: 'changelog_unavailable', message: error instanceof Error ? error.message : 'Organization details could not be loaded.' },
      { status: 502 },
    );
  }
}

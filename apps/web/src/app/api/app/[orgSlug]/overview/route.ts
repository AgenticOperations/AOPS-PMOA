import { NextResponse } from 'next/server';
import { loadOverviewHome } from '@/lib/server/overview-home-loader';

type OverviewRouteContext = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export async function GET(_request: Request, { params }: OverviewRouteContext) {
  const { orgSlug } = await params;

  try {
    const data = await loadOverviewHome(orgSlug);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Overview could not be loaded.';
    const unauthorized = /unauthorized|unauthenticated|forbidden/i.test(message);
    return NextResponse.json(
      {
        error: unauthorized ? 'unauthorized' : 'overview_unavailable',
        message,
      },
      { status: unauthorized ? 401 : 500 },
    );
  }
}

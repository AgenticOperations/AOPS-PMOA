import { NextResponse } from 'next/server';
import { getChangelogStatus } from '@/lib/server/changelog-client';

export async function GET() {
  try {
    return NextResponse.json(await getChangelogStatus());
  } catch (error) {
    return NextResponse.json(
      { error: 'changelog_unavailable', message: error instanceof Error ? error.message : 'Status could not be loaded.' },
      { status: 502 },
    );
  }
}

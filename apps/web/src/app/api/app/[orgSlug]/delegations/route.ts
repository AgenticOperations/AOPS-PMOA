import { NextResponse, type NextRequest } from 'next/server';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
import { listDelegations, recordDelegation, type RecordDelegationRequest } from '@/lib/server/payments-client';

type RouteContext = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { orgSlug } = await params;
  try {
    const org = await getOrgBySlug(orgSlug);
    return NextResponse.json({ delegations: await listDelegations(org.id) });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'delegations_unavailable',
        message: error instanceof Error ? error.message : 'Delegations could not be loaded.',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { orgSlug } = await params;
  try {
    const org = await getOrgBySlug(orgSlug);
    const body = (await request.json()) as RecordDelegationRequest;
    return NextResponse.json(await recordDelegation(org.id, body), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'delegation_record_failed',
        message: error instanceof Error ? error.message : 'The delegation could not be recorded.',
      },
      { status: 500 },
    );
  }
}

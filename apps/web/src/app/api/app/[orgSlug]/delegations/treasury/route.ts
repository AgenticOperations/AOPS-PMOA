import { NextResponse, type NextRequest } from 'next/server';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
import {
  createTreasuryDelegation,
  PaymentsApiError,
  type TreasuryDelegationRequest,
} from '@/lib/server/payments-client';

type RouteContext = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { orgSlug } = await params;
  try {
    const org = await getOrgBySlug(orgSlug);
    const body = (await request.json()) as TreasuryDelegationRequest;
    return NextResponse.json(await createTreasuryDelegation(org.id, body), { status: 201 });
  } catch (error) {
    // A ceiling or solvency rejection is an expected state, not a fault.
    // Flattening it to a 500 would tell the operator something broke when
    // in fact the system did exactly what they configured it to do.
    if (error instanceof PaymentsApiError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        error: 'delegation_record_failed',
        message: error instanceof Error ? error.message : 'The delegation could not be recorded.',
      },
      { status: 500 },
    );
  }
}

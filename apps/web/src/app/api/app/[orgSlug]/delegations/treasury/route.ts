import { NextResponse, type NextRequest } from 'next/server';
import { isGasIndexerInsufficientMessage } from '@/lib/delegation-errors';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
import {
  createTreasuryDelegation,
  PaymentsApiError,
  type TreasuryDelegationRequest,
} from '@/lib/server/payments-client';

type RouteContext = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

function delegationFailurePayload(error: unknown): { readonly error: string; readonly message: string } {
  const message = error instanceof Error ? error.message : 'The delegation could not be recorded.';
  if (isGasIndexerInsufficientMessage(message)) {
    return { error: 'delegation_gas_indexer_pending', message };
  }
  return { error: 'delegation_record_failed', message };
}

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
      if (isGasIndexerInsufficientMessage(error.message)) {
        return NextResponse.json(
          { error: 'delegation_gas_indexer_pending', message: error.message },
          { status: 502 },
        );
      }
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(delegationFailurePayload(error), { status: 500 });
  }
}

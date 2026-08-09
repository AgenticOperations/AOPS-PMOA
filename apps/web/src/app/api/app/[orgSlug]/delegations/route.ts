import { NextResponse, type NextRequest } from 'next/server';
import { isGasIndexerInsufficientMessage } from '@/lib/delegation-errors';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
import { listDelegations, recordDelegation, type RecordDelegationRequest } from '@/lib/server/payments-client';

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
    return NextResponse.json(delegationFailurePayload(error), { status: 500 });
  }
}

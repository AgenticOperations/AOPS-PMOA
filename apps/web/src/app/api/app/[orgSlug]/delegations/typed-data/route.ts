import { NextResponse, type NextRequest } from 'next/server';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
import { buildDelegationTypedData, type DelegationTypedDataRequest } from '@/lib/server/payments-client';

type RouteContext = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

/**
 * Builds the EIP-712 payload the operator's wallet signs to delegate
 * spending to an agent. Pure read: nothing is written and nothing goes
 * on-chain here. The nonce in the response must be sent back unchanged
 * when recording the signature.
 */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { orgSlug } = await params;
  try {
    const org = await getOrgBySlug(orgSlug);
    const body = (await request.json()) as DelegationTypedDataRequest;
    return NextResponse.json(await buildDelegationTypedData(org.id, body));
  } catch (error) {
    return NextResponse.json(
      {
        error: 'delegation_typed_data_failed',
        message: error instanceof Error ? error.message : 'Could not build the delegation payload.',
      },
      { status: 500 },
    );
  }
}

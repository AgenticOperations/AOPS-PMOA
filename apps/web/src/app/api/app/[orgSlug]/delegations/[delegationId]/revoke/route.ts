import { NextResponse, type NextRequest } from 'next/server';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
import { revokeDelegation } from '@/lib/server/payments-client';

type RouteContext = {
  readonly params: Promise<{ readonly orgSlug: string; readonly delegationId: string }>;
};

/**
 * Always stops this control plane from issuing further drawdowns. The
 * onChainRevoked flag in the response says whether the Permit2 allowance
 * itself was closed -- it cannot be for a user-owned payer, since only the
 * allowance owner may call lockdown(). The UI must relay that distinction.
 */
export async function POST(_request: NextRequest, { params }: RouteContext) {
  const { orgSlug, delegationId } = await params;
  try {
    const org = await getOrgBySlug(orgSlug);
    return NextResponse.json(await revokeDelegation(org.id, delegationId));
  } catch (error) {
    return NextResponse.json(
      {
        error: 'delegation_revoke_failed',
        message: error instanceof Error ? error.message : 'The delegation could not be revoked.',
      },
      { status: 500 },
    );
  }
}

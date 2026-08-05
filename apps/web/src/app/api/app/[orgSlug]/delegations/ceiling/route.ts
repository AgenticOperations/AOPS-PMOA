import { NextResponse, type NextRequest } from 'next/server';
import { getOrgBySlug } from '@/lib/server/identity-spine-client';
import { listOrgCeilings, PaymentsApiError, setOrgCeiling } from '@/lib/server/payments-client';
import type { PaymentChain } from '@/lib/payments-types';

type RouteContext = {
  readonly params: Promise<{ readonly orgSlug: string }>;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { orgSlug } = await params;
  try {
    const org = await getOrgBySlug(orgSlug);
    return NextResponse.json({ ceilings: await listOrgCeilings(org.id) });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'ceilings_unavailable',
        message: error instanceof Error ? error.message : 'Ceilings could not be loaded.',
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const { orgSlug } = await params;
  try {
    const org = await getOrgBySlug(orgSlug);
    const body = (await request.json()) as { readonly chain: PaymentChain; readonly ceiling_usdc: string };
    return NextResponse.json(await setOrgCeiling(org.id, body));
  } catch (error) {
    if (error instanceof PaymentsApiError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    return NextResponse.json(
      {
        error: 'ceiling_update_failed',
        message: error instanceof Error ? error.message : 'The ceiling could not be saved.',
      },
      { status: 500 },
    );
  }
}

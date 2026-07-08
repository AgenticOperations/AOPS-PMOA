'use server';

import { revalidatePath } from 'next/cache';
import { approveApproval, denyApproval } from '@/lib/server/approval-client';

function approvalsPath(orgSlug: string): string {
  return `/app/${orgSlug}/approvals`;
}

export async function approveApprovalAction(
  orgId: string,
  orgSlug: string,
  approvalId: string,
): Promise<void> {
  await approveApproval(orgId, approvalId, 'Approved from agentOps approval inbox.');
  revalidatePath(approvalsPath(orgSlug));
}

export async function denyApprovalAction(
  orgId: string,
  orgSlug: string,
  approvalId: string,
): Promise<void> {
  await denyApproval(orgId, approvalId, 'Denied from agentOps approval inbox.');
  revalidatePath(approvalsPath(orgSlug));
}

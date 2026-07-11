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
  formData?: FormData,
): Promise<void> {
  const note = formData?.get('note');
  await approveApproval(
    orgId,
    approvalId,
    typeof note === 'string' && note.trim().length > 0 ? note.trim() : 'Approved from agentOps approval inbox.',
  );
  revalidatePath(approvalsPath(orgSlug));
}

export async function denyApprovalAction(
  orgId: string,
  orgSlug: string,
  approvalId: string,
  formData?: FormData,
): Promise<void> {
  const note = formData?.get('note');
  await denyApproval(
    orgId,
    approvalId,
    typeof note === 'string' && note.trim().length > 0 ? note.trim() : 'Denied from agentOps approval inbox.',
  );
  revalidatePath(approvalsPath(orgSlug));
}

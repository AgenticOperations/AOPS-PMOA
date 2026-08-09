'use server';

import { revalidatePath } from 'next/cache';
import {
  createAgentJoinInvite,
  revokeAgentJoinInvite,
} from '@/lib/server/identity-spine-client';
import { readWebEnv } from '@/lib/env';

export type JoinInviteActionState = {
  readonly error?: string;
  readonly token?: string;
  readonly label?: string;
  readonly redeemUrl?: string;
};

function joinInvitesPath(orgSlug: string): string {
  return `/app/${orgSlug}/agents`;
}

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function optionalPositiveInt(formData: FormData, key: string): number | undefined {
  const raw = stringField(formData, key);
  if (raw.length === 0) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive whole number.`);
  }
  return value;
}

export async function createJoinInviteAction(
  orgId: string,
  orgSlug: string,
  _prev: JoinInviteActionState,
  formData: FormData,
): Promise<JoinInviteActionState> {
  try {
    const label = stringField(formData, 'label');
    const maxUses = optionalPositiveInt(formData, 'max_uses') ?? 1;
    const expiresInHours = optionalPositiveInt(formData, 'expires_in_hours');
    const created = await createAgentJoinInvite(orgId, {
      ...(label.length > 0 ? { label } : {}),
      max_uses: maxUses,
      ...(expiresInHours === undefined ? {} : { expires_in_hours: expiresInHours }),
    });
    revalidatePath(joinInvitesPath(orgSlug));
    const apiBase = readWebEnv().AGENTOPS_API_BASE_URL.replace(/\/$/, '');
    return {
      token: created.token,
      label: created.invite.label || 'Sandbox join',
      redeemUrl: `${apiBase}/v1/agent-join/invite/redeem`,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not create join invite.',
    };
  }
}

export async function revokeJoinInviteAction(
  orgId: string,
  orgSlug: string,
  formData: FormData,
): Promise<void> {
  const inviteId = stringField(formData, 'invite_id');
  if (inviteId.length === 0) throw new Error('invite_id is required');
  await revokeAgentJoinInvite(orgId, inviteId);
  revalidatePath(joinInvitesPath(orgSlug));
}

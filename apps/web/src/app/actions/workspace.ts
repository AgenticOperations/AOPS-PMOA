'use server';

import { revalidatePath } from 'next/cache';
import {
  addMember,
  archiveTeam,
  createTeam,
  removeMember,
  updateMember,
  updateTeam,
  upsertOnboardingState,
} from '@/lib/server/identity-spine-client';
import type { Role } from '@/lib/identity-spine-types';

const ROLES = new Set<Role>(['owner', 'admin', 'operator', 'auditor', 'viewer', 'member']);

function settingsPath(orgSlug: string): string {
  return `/app/${orgSlug}/settings`;
}

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function requiredStringField(formData: FormData, key: string): string {
  const value = stringField(formData, key);
  if (value.length === 0) throw new Error(`${key} is required`);
  return value;
}

function roleField(formData: FormData): Role {
  const value = stringField(formData, 'role');
  if (ROLES.has(value as Role)) return value as Role;
  throw new Error('role is invalid');
}

export async function addMemberAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await addMember(orgId, {
    email: requiredStringField(formData, 'email'),
    name: stringField(formData, 'name') || undefined,
    role: roleField(formData),
  });
  revalidatePath(settingsPath(orgSlug));
}

export async function updateMemberRoleAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await updateMember(orgId, requiredStringField(formData, 'memberId'), { role: roleField(formData) });
  revalidatePath(settingsPath(orgSlug));
}

export async function removeMemberAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await removeMember(orgId, requiredStringField(formData, 'memberId'));
  revalidatePath(settingsPath(orgSlug));
}

export async function createTeamAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await createTeam(orgId, {
    name: requiredStringField(formData, 'name'),
    description: stringField(formData, 'description') || undefined,
  });
  revalidatePath(settingsPath(orgSlug));
}

export async function updateTeamAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await updateTeam(orgId, requiredStringField(formData, 'teamId'), {
    name: requiredStringField(formData, 'name'),
    description: stringField(formData, 'description'),
  });
  revalidatePath(settingsPath(orgSlug));
}

export async function archiveTeamAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await archiveTeam(orgId, requiredStringField(formData, 'teamId'));
  revalidatePath(settingsPath(orgSlug));
}

export async function skipOnboardingStepAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  const flowKey = requiredStringField(formData, 'flowKey');
  await upsertOnboardingState(orgId, flowKey, {
    status: 'completed',
    payload: { skipped: true, skipped_at: new Date().toISOString() },
  });
  revalidatePath(settingsPath(orgSlug));
  revalidatePath(`/app/${orgSlug}/overview`);
}

'use server';

import { revalidatePath } from 'next/cache';
import {
  activatePolicyDraft,
  bindPolicy,
  createPolicyDraft,
  validatePolicyDraft,
} from '@/lib/server/policy-client';

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function optionalStringField(formData: FormData, key: string): string | undefined {
  const value = stringField(formData, key);
  return value.length > 0 ? value : undefined;
}

function requiredStringField(formData: FormData, key: string): string {
  const value = stringField(formData, key);
  if (value.length === 0) throw new Error(`${key} is required`);
  return value;
}

function controlsPath(orgSlug: string): string {
  return `/app/${orgSlug}/controls`;
}

function targetFromKey(value: string): { readonly targetType: string; readonly targetId: string } {
  const [targetType, ...idParts] = value.split(':');
  const targetId = idParts.join(':');
  if (targetType === undefined || targetId.length === 0) throw new Error('targetKey is invalid');
  return { targetId, targetType };
}

export async function createPolicyDraftAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await createPolicyDraft(orgId, {
    name: requiredStringField(formData, 'name'),
    description: optionalStringField(formData, 'description'),
    action: requiredStringField(formData, 'action'),
    decision: requiredStringField(formData, 'decision'),
    actorRole: optionalStringField(formData, 'actorRole'),
    resourceCategory: optionalStringField(formData, 'resourceCategory'),
    resourceDomain: optionalStringField(formData, 'resourceDomain'),
    paymentMinAmount: optionalStringField(formData, 'paymentMinAmount'),
    paymentAsset: optionalStringField(formData, 'paymentAsset'),
    toolName: optionalStringField(formData, 'toolName'),
  });
  revalidatePath(controlsPath(orgSlug));
}

export async function validatePolicyDraftAction(orgId: string, orgSlug: string, draftId: string): Promise<void> {
  await validatePolicyDraft(orgId, draftId);
  revalidatePath(controlsPath(orgSlug));
}

export async function activatePolicyDraftAction(orgId: string, orgSlug: string, draftId: string): Promise<void> {
  await activatePolicyDraft(orgId, draftId, 'Activated from Controls.');
  revalidatePath(controlsPath(orgSlug));
}

export async function bindPolicyAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  const target = targetFromKey(requiredStringField(formData, 'targetKey'));
  await bindPolicy(orgId, {
    policyId: requiredStringField(formData, 'policyId'),
    policyVersion: Number(requiredStringField(formData, 'policyVersion')),
    targetId: target.targetId,
    targetType: target.targetType,
  });
  revalidatePath(controlsPath(orgSlug));
}

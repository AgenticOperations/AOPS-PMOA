'use server';

import { revalidatePath } from 'next/cache';
import {
  activatePolicyDraft,
  archivePolicy,
  bindPolicy,
  createPolicyDraft,
  createPolicyVersion,
  discardPolicyDraft,
  removePolicyBinding,
  simulatePolicyDraft,
  updatePolicyDraft,
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

export async function updatePolicyDraftAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await updatePolicyDraft(orgId, requiredStringField(formData, 'draftId'), {
    name: requiredStringField(formData, 'name'),
    description: optionalStringField(formData, 'description'),
    category: requiredStringField(formData, 'category') as 'management' | 'operational' | 'capability',
  });
  revalidatePath(controlsPath(orgSlug));
}

export async function discardPolicyDraftAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await discardPolicyDraft(orgId, requiredStringField(formData, 'draftId'));
  revalidatePath(controlsPath(orgSlug));
}

export async function removePolicyBindingAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await removePolicyBinding(orgId, requiredStringField(formData, 'policyId'), requiredStringField(formData, 'bindingId'));
  revalidatePath(controlsPath(orgSlug));
}

export async function archivePolicyAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await archivePolicy(orgId, requiredStringField(formData, 'policyId'), optionalStringField(formData, 'changeReason') ?? 'Archived from Controls.');
  revalidatePath(controlsPath(orgSlug));
}

export async function createPolicyVersionAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await createPolicyVersion(orgId, requiredStringField(formData, 'policyId'), {
    name: optionalStringField(formData, 'name'),
    description: optionalStringField(formData, 'description'),
    category: optionalStringField(formData, 'category') as 'management' | 'operational' | 'capability' | undefined,
    change_reason: optionalStringField(formData, 'changeReason') ?? 'New version from Controls.',
  });
  revalidatePath(controlsPath(orgSlug));
}

export async function simulatePolicyDraftAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  const target = targetFromKey(requiredStringField(formData, 'targetKey'));
  const context: Record<string, unknown> = {};
  const resourceCategory = optionalStringField(formData, 'resourceCategory');
  const resourceDomain = optionalStringField(formData, 'resourceDomain');
  const paymentAmount = optionalStringField(formData, 'paymentAmount');
  const paymentAsset = optionalStringField(formData, 'paymentAsset');
  const toolName = optionalStringField(formData, 'toolName');

  if (resourceCategory !== undefined || resourceDomain !== undefined) {
    context.resource = {
      ...(resourceCategory === undefined ? {} : { category: resourceCategory }),
      ...(resourceDomain === undefined ? {} : { domain: resourceDomain }),
    };
  }
  if (paymentAmount !== undefined || paymentAsset !== undefined) {
    context.payment = {
      ...(paymentAmount === undefined ? {} : { amount: paymentAmount }),
      ...(paymentAsset === undefined ? {} : { asset: paymentAsset }),
    };
  }
  if (toolName !== undefined) {
    context.tool = { name: toolName };
  }

  await simulatePolicyDraft(orgId, requiredStringField(formData, 'draftId'), {
    actor: {
      type: 'user',
      role: optionalStringField(formData, 'actorRole') ?? 'member',
    },
    action: requiredStringField(formData, 'action'),
    target: {
      type: target.targetType as 'agent' | 'connection' | 'org' | 'team',
      id: target.targetId,
    },
    context,
  });
  revalidatePath(controlsPath(orgSlug));
}

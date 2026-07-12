'use server';

import { revalidatePath } from 'next/cache';
import {
  activatePolicyDraft,
  activatePolicyRevisionDraft,
  archivePolicy,
  bindPolicy,
  createPolicyDraft,
  createPolicyRestoreDraft,
  createPolicyRevisionDraft,
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

function agentPath(orgSlug: string, agentId: string): string {
  return `/app/${orgSlug}/agents/${agentId}`;
}

function targetFromKey(value: string): { readonly targetType: string; readonly targetId: string } {
  const [targetType, ...idParts] = value.split(':');
  const targetId = idParts.join(':');
  if (targetType === undefined || targetId.length === 0) throw new Error('targetKey is invalid');
  return { targetId, targetType };
}

function domainFromUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    return new URL(value).hostname || undefined;
  } catch {
    return undefined;
  }
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
    paymentMaxAmount: optionalStringField(formData, 'paymentMaxAmount'),
    paymentAsset: optionalStringField(formData, 'paymentAsset'),
    paymentNetwork: optionalStringField(formData, 'paymentNetwork'),
    paymentRecipient: optionalStringField(formData, 'paymentRecipient'),
    toolName: optionalStringField(formData, 'toolName'),
    toolRiskLevel: optionalStringField(formData, 'toolRiskLevel'),
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

export async function activatePolicyRevisionDraftAction(orgId: string, orgSlug: string, draftId: string): Promise<void> {
  await activatePolicyRevisionDraft(orgId, draftId, 'Activated revision from Controls.');
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

export async function bindAgentPolicyAction(orgId: string, orgSlug: string, agentId: string, formData: FormData): Promise<void> {
  const selection = optionalStringField(formData, 'policySelection');
  const [selectedPolicyId, selectedPolicyVersion] = selection === undefined ? [] : selection.split(':');
  await bindPolicy(orgId, {
    policyId: selectedPolicyId ?? requiredStringField(formData, 'policyId'),
    policyVersion: Number(selectedPolicyVersion ?? requiredStringField(formData, 'policyVersion')),
    targetId: agentId,
    targetType: 'agent',
  });
  revalidatePath(agentPath(orgSlug, agentId));
}

export async function updatePolicyDraftAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await updatePolicyDraft(orgId, requiredStringField(formData, 'draftId'), {
    statementId: optionalStringField(formData, 'statementId'),
    name: requiredStringField(formData, 'name'),
    description: optionalStringField(formData, 'description'),
    category: requiredStringField(formData, 'category') as 'management' | 'operational' | 'capability',
    action: requiredStringField(formData, 'action'),
    decision: requiredStringField(formData, 'decision'),
    actorRole: optionalStringField(formData, 'actorRole'),
    resourceCategory: optionalStringField(formData, 'resourceCategory'),
    resourceDomain: optionalStringField(formData, 'resourceDomain'),
    paymentMinAmount: optionalStringField(formData, 'paymentMinAmount'),
    paymentMaxAmount: optionalStringField(formData, 'paymentMaxAmount'),
    paymentAsset: optionalStringField(formData, 'paymentAsset'),
    paymentNetwork: optionalStringField(formData, 'paymentNetwork'),
    paymentRecipient: optionalStringField(formData, 'paymentRecipient'),
    toolName: optionalStringField(formData, 'toolName'),
    toolRiskLevel: optionalStringField(formData, 'toolRiskLevel'),
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

export async function removeAgentPolicyBindingAction(orgId: string, orgSlug: string, agentId: string, formData: FormData): Promise<void> {
  await removePolicyBinding(orgId, requiredStringField(formData, 'policyId'), requiredStringField(formData, 'bindingId'));
  revalidatePath(agentPath(orgSlug, agentId));
}

export async function archivePolicyAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await archivePolicy(orgId, requiredStringField(formData, 'policyId'), optionalStringField(formData, 'changeReason') ?? 'Archived from Controls.');
  revalidatePath(controlsPath(orgSlug));
}

export async function createPolicyRevisionDraftAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await createPolicyRevisionDraft(orgId, requiredStringField(formData, 'policyId'), {
    name: optionalStringField(formData, 'name'),
    description: optionalStringField(formData, 'description'),
    category: optionalStringField(formData, 'category') as 'management' | 'operational' | 'capability' | undefined,
  });
  revalidatePath(controlsPath(orgSlug));
}

export async function createPolicyRestoreDraftAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  const restoreBindings = formData
    .getAll('restoreTargetKey')
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map(targetFromKey)
    .map((target) => ({
      target_id: target.targetId,
      target_type: target.targetType as 'agent' | 'connection' | 'org' | 'team',
    }));

  await createPolicyRestoreDraft(orgId, requiredStringField(formData, 'policyId'), {
    restore_bindings: restoreBindings,
  });
  revalidatePath(controlsPath(orgSlug));
}

export async function simulatePolicyDraftAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  const target = targetFromKey(requiredStringField(formData, 'targetKey'));
  const context: Record<string, unknown> = {};
  const resourceUrl = optionalStringField(formData, 'resourceUrl');
  const resourceCategory = optionalStringField(formData, 'resourceCategory');
  const resourceDomain = optionalStringField(formData, 'resourceDomain') ?? domainFromUrl(resourceUrl);
  const paymentAmount = optionalStringField(formData, 'paymentAmount');
  const paymentAsset = optionalStringField(formData, 'paymentAsset');
  const paymentNetwork = optionalStringField(formData, 'paymentNetwork');
  const paymentRecipient = optionalStringField(formData, 'paymentRecipient');
  const toolName = optionalStringField(formData, 'toolName');
  const toolRiskLevel = optionalStringField(formData, 'toolRiskLevel');

  if (resourceUrl !== undefined || resourceCategory !== undefined || resourceDomain !== undefined) {
    context.resource = {
      ...(resourceUrl === undefined ? {} : { url: resourceUrl }),
      ...(resourceCategory === undefined ? {} : { category: resourceCategory }),
      ...(resourceDomain === undefined ? {} : { domain: resourceDomain }),
    };
  }
  if (
    paymentAmount !== undefined ||
    paymentAsset !== undefined ||
    paymentNetwork !== undefined ||
    paymentRecipient !== undefined
  ) {
    context.payment = {
      ...(paymentAmount === undefined ? {} : { amount: paymentAmount }),
      ...(paymentAsset === undefined ? {} : { asset: paymentAsset }),
      ...(paymentNetwork === undefined ? {} : { network: paymentNetwork }),
      ...(paymentRecipient === undefined ? {} : { recipient: paymentRecipient }),
    };
  }
  if (toolName !== undefined || toolRiskLevel !== undefined) {
    context.tool = {
      ...(toolName === undefined ? {} : { name: toolName }),
      ...(toolRiskLevel === undefined ? {} : { riskLevel: toolRiskLevel }),
    };
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

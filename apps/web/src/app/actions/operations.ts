'use server';

import { revalidatePath } from 'next/cache';
import {
  archiveTool,
  createRateLimit,
  disableRateLimit,
  importTools,
  updateRateLimit,
  updateTool,
} from '@/lib/server/operations-client';
import type { OperationalAction, ToolRiskLevel } from '@/lib/operations-types';

function operationsPath(orgSlug: string): string {
  return `/app/${orgSlug}/operations`;
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

function optionalStringField(formData: FormData, key: string): string | undefined {
  const value = stringField(formData, key);
  return value.length > 0 ? value : undefined;
}

function numberField(formData: FormData, key: string): number {
  const raw = requiredStringField(formData, key);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${key} must be a number`);
  return parsed;
}

function riskLevelField(formData: FormData): ToolRiskLevel {
  const value = optionalStringField(formData, 'riskLevel');
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'critical') return value;
  return 'medium';
}

function actionField(formData: FormData): OperationalAction {
  const value = requiredStringField(formData, 'action');
  if (value === 'runtime.http.request' || value === 'tool.call') return value;
  throw new Error('Unsupported operation action');
}

export async function importToolAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await importTools(orgId, [
    {
      name: requiredStringField(formData, 'name'),
      display_name: optionalStringField(formData, 'displayName'),
      category: optionalStringField(formData, 'category'),
      risk_level: riskLevelField(formData),
      description: optionalStringField(formData, 'description'),
    },
  ]);
  revalidatePath(operationsPath(orgSlug));
}

export async function createOperationLimitAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await createRateLimit(orgId, {
    target_type: 'agent',
    target_id: requiredStringField(formData, 'targetId'),
    action: actionField(formData),
    bucket: optionalStringField(formData, 'bucket'),
    limit: numberField(formData, 'limit'),
    window_seconds: numberField(formData, 'windowSeconds'),
  });
  revalidatePath(operationsPath(orgSlug));
}

export async function updateToolAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await updateTool(orgId, requiredStringField(formData, 'toolId'), {
    display_name: requiredStringField(formData, 'displayName'),
    category: optionalStringField(formData, 'category'),
    risk_level: riskLevelField(formData),
    description: optionalStringField(formData, 'description'),
  });
  revalidatePath(operationsPath(orgSlug));
}

export async function archiveToolAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await archiveTool(orgId, requiredStringField(formData, 'toolId'));
  revalidatePath(operationsPath(orgSlug));
}

export async function updateOperationLimitAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  const status = stringField(formData, 'status') === 'disabled' ? 'disabled' : 'active';
  await updateRateLimit(orgId, requiredStringField(formData, 'rateLimitId'), {
    bucket: optionalStringField(formData, 'bucket'),
    limit: numberField(formData, 'limit'),
    window_seconds: numberField(formData, 'windowSeconds'),
    status,
  });
  revalidatePath(operationsPath(orgSlug));
}

export async function disableOperationLimitAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await disableRateLimit(orgId, requiredStringField(formData, 'rateLimitId'));
  revalidatePath(operationsPath(orgSlug));
}

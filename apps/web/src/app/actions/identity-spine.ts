'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  activateAgent,
  attachWalletRef,
  createAgent,
  createConnection,
  createOrg,
  deactivateAgent,
  detachWalletRef,
  pauseAgent,
  revokeConnection,
  rotateConnection,
  testConnection,
  updateAgent,
} from '@/lib/server/identity-spine-client';

export type ConnectionActionState = {
  readonly error?: string;
  readonly message?: string;
  readonly secret?: {
    readonly connectionName: string;
    readonly secret: string;
  };
};

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function requiredStringField(formData: FormData, key: string): string {
  const value = stringField(formData, key);
  if (value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalStringField(formData: FormData, key: string): string | undefined {
  const value = stringField(formData, key);
  return value.length > 0 ? value : undefined;
}

function connectionKindField(formData: FormData): string {
  return optionalStringField(formData, 'kind') ?? 'agent_credential';
}

function connectionSecretState(result: Awaited<ReturnType<typeof createConnection>>): ConnectionActionState {
  return result.secret === null
    ? {}
    : {
        secret: {
          connectionName: result.connection.name,
          secret: result.secret,
        },
      };
}

function connectionActionErrorState(error: unknown): ConnectionActionState {
  const message = (error as Error).message;
  return {
    error: message.includes('Connection was not found')
      ? 'This credential is no longer active. Use an active credential or create a new one.'
      : message,
  };
}

function agentListPath(orgSlug: string): string {
  return `/app/${orgSlug}/agents`;
}

function agentDetailPath(orgSlug: string, agentId: string): string {
  return `/app/${orgSlug}/agents/${agentId}`;
}

export async function createOrgAction(formData: FormData): Promise<void> {
  const name = stringField(formData, 'name');
  const org = await createOrg({
    name,
  });

  revalidatePath('/auth');
  redirect(`/onboarding/${org.slug}`);
}

export async function createAgentAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await createAgent(orgId, {
    name: stringField(formData, 'name'),
  });

  revalidatePath(agentListPath(orgSlug));
}

export async function updateAgentAction(orgId: string, orgSlug: string, agentId: string, formData: FormData): Promise<void> {
  const labels = stringField(formData, 'labels')
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
  await updateAgent(orgId, agentId, {
    name: requiredStringField(formData, 'name'),
    team_id: optionalStringField(formData, 'teamId'),
    description: stringField(formData, 'description'),
    labels,
    default_environment: optionalStringField(formData, 'defaultEnvironment') ?? null,
  });
  revalidatePath(agentDetailPath(orgSlug, agentId));
  revalidatePath(agentListPath(orgSlug));
}

export async function pauseAgentAction(orgId: string, orgSlug: string, agentId: string): Promise<void> {
  await pauseAgent(orgId, agentId);
  revalidatePath(agentDetailPath(orgSlug, agentId));
  revalidatePath(agentListPath(orgSlug));
}

export async function activateAgentAction(orgId: string, orgSlug: string, agentId: string): Promise<void> {
  await activateAgent(orgId, agentId);
  revalidatePath(agentDetailPath(orgSlug, agentId));
  revalidatePath(agentListPath(orgSlug));
}

export async function deactivateAgentAction(orgId: string, orgSlug: string, agentId: string): Promise<void> {
  await deactivateAgent(orgId, agentId);
  revalidatePath(agentDetailPath(orgSlug, agentId));
  revalidatePath(agentListPath(orgSlug));
}

export async function createConnectionAction(
  orgId: string,
  orgSlug: string,
  agentId: string,
  _previousState: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> {
  try {
    const result = await createConnection(orgId, agentId, {
      kind: connectionKindField(formData),
      name: stringField(formData, 'name'),
    });
    revalidatePath(agentDetailPath(orgSlug, agentId));
    return connectionSecretState(result);
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function createConnectionFromFormAction(
  _previousState: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> {
  try {
    const orgId = requiredStringField(formData, 'orgId');
    const orgSlug = requiredStringField(formData, 'orgSlug');
    const agentId = requiredStringField(formData, 'agentId');
    const result = await createConnection(orgId, agentId, {
      kind: connectionKindField(formData),
      name: stringField(formData, 'name'),
    });
    revalidatePath(agentDetailPath(orgSlug, agentId));
    return connectionSecretState(result);
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function testConnectionAction(
  orgId: string,
  orgSlug: string,
  agentId: string,
  connectionId: string,
): Promise<ConnectionActionState> {
  try {
    await testConnection(orgId, connectionId);
    revalidatePath(agentDetailPath(orgSlug, agentId));
    return { message: 'Credential test passed.' };
  } catch (error) {
    revalidatePath(agentDetailPath(orgSlug, agentId));
    return connectionActionErrorState(error);
  }
}

export async function testConnectionFromFormAction(
  _previousState: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> {
  const orgSlug = requiredStringField(formData, 'orgSlug');
  const agentId = requiredStringField(formData, 'agentId');
  try {
    const orgId = requiredStringField(formData, 'orgId');
    const connectionId = requiredStringField(formData, 'connectionId');
    await testConnection(orgId, connectionId);
    revalidatePath(agentDetailPath(orgSlug, agentId));
    return { message: 'Credential test passed.' };
  } catch (error) {
    revalidatePath(agentDetailPath(orgSlug, agentId));
    return connectionActionErrorState(error);
  }
}

export async function rotateConnectionAction(
  orgId: string,
  orgSlug: string,
  agentId: string,
  connectionId: string,
  _previousState: ConnectionActionState,
): Promise<ConnectionActionState> {
  try {
    const result = await rotateConnection(orgId, connectionId);
    revalidatePath(agentDetailPath(orgSlug, agentId));
    return connectionSecretState(result);
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function rotateConnectionFromFormAction(
  _previousState: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> {
  try {
    const orgId = requiredStringField(formData, 'orgId');
    const orgSlug = requiredStringField(formData, 'orgSlug');
    const agentId = requiredStringField(formData, 'agentId');
    const connectionId = requiredStringField(formData, 'connectionId');
    const result = await rotateConnection(orgId, connectionId);
    revalidatePath(agentDetailPath(orgSlug, agentId));
    return connectionSecretState(result);
  } catch (error) {
    return { error: (error as Error).message };
  }
}

export async function revokeConnectionAction(
  orgId: string,
  orgSlug: string,
  agentId: string,
  connectionId: string,
): Promise<ConnectionActionState> {
  try {
    await revokeConnection(orgId, connectionId);
    revalidatePath(agentDetailPath(orgSlug, agentId));
    return {};
  } catch (error) {
    revalidatePath(agentDetailPath(orgSlug, agentId));
    return connectionActionErrorState(error);
  }
}

export async function revokeConnectionFromFormAction(
  _previousState: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> {
  const orgSlug = requiredStringField(formData, 'orgSlug');
  const agentId = requiredStringField(formData, 'agentId');
  try {
    const orgId = requiredStringField(formData, 'orgId');
    const connectionId = requiredStringField(formData, 'connectionId');
    await revokeConnection(orgId, connectionId);
    revalidatePath(agentDetailPath(orgSlug, agentId));
    return {};
  } catch (error) {
    revalidatePath(agentDetailPath(orgSlug, agentId));
    return connectionActionErrorState(error);
  }
}

export async function attachWalletRefAction(
  orgId: string,
  orgSlug: string,
  agentId: string,
  formData: FormData,
): Promise<void> {
  await attachWalletRef(orgId, agentId, {
    provider: stringField(formData, 'provider'),
    external_wallet_id: optionalStringField(formData, 'externalWalletId') ?? null,
    address: optionalStringField(formData, 'address') ?? null,
    chain: optionalStringField(formData, 'chain') ?? null,
    label: optionalStringField(formData, 'label'),
  });
  revalidatePath(agentDetailPath(orgSlug, agentId));
}

export async function attachWalletRefFromFormAction(formData: FormData): Promise<void> {
  const orgId = requiredStringField(formData, 'orgId');
  const orgSlug = requiredStringField(formData, 'orgSlug');
  const agentId = requiredStringField(formData, 'agentId');
  await attachWalletRef(orgId, agentId, {
    provider: stringField(formData, 'provider'),
    external_wallet_id: optionalStringField(formData, 'externalWalletId') ?? null,
    address: optionalStringField(formData, 'address') ?? null,
    chain: optionalStringField(formData, 'chain') ?? null,
    label: optionalStringField(formData, 'label'),
  });
  revalidatePath(agentDetailPath(orgSlug, agentId));
}

export async function detachWalletRefAction(
  orgId: string,
  orgSlug: string,
  agentId: string,
  walletRefId: string,
): Promise<void> {
  await detachWalletRef(orgId, agentId, walletRefId);
  revalidatePath(agentDetailPath(orgSlug, agentId));
}

export async function detachWalletRefFromFormAction(formData: FormData): Promise<void> {
  const orgId = requiredStringField(formData, 'orgId');
  const orgSlug = requiredStringField(formData, 'orgSlug');
  const agentId = requiredStringField(formData, 'agentId');
  const walletRefId = requiredStringField(formData, 'walletRefId');
  await detachWalletRef(orgId, agentId, walletRefId);
  revalidatePath(agentDetailPath(orgSlug, agentId));
}

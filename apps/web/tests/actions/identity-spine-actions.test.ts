import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testConnectionFromFormAction } from '../../src/app/actions/identity-spine.js';
import { testConnection } from '@/lib/server/identity-spine-client.js';
import { revalidatePath } from 'next/cache';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('@/lib/server/identity-spine-client.js', () => ({
  activateAgent: vi.fn(),
  attachWalletRef: vi.fn(),
  createAgent: vi.fn(),
  createConnection: vi.fn(),
  createOrg: vi.fn(),
  deactivateAgent: vi.fn(),
  detachWalletRef: vi.fn(),
  pauseAgent: vi.fn(),
  revokeConnection: vi.fn(),
  rotateConnection: vi.fn(),
  testConnection: vi.fn(),
}));

describe('identity spine actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('revalidates the slug-scoped agent detail route after testing a credential', async () => {
    const formData = new FormData();
    formData.set('orgId', 'org_acme');
    formData.set('orgSlug', 'acme-agent-ops');
    formData.set('agentId', 'agt_research');
    formData.set('connectionId', 'conn_local');

    const result = await testConnectionFromFormAction({}, formData);

    expect(testConnection).toHaveBeenCalledWith('org_acme', 'conn_local');
    expect(revalidatePath).toHaveBeenCalledWith('/app/acme-agent-ops/agents/agt_research');
    expect(result).toEqual({ message: 'Credential test passed.' });
  });

  it('returns a controlled state when testing a stale credential fails', async () => {
    vi.mocked(testConnection).mockRejectedValueOnce(new Error('Connection was not found.'));
    const formData = new FormData();
    formData.set('orgId', 'org_acme');
    formData.set('orgSlug', 'acme-agent-ops');
    formData.set('agentId', 'agt_research');
    formData.set('connectionId', 'conn_revoked');

    const result = await testConnectionFromFormAction({}, formData);

    expect(result).toEqual({
      error: 'This credential is no longer active. Use an active credential or create a new one.',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/app/acme-agent-ops/agents/agt_research');
  });
});

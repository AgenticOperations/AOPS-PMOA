import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/server/mcp-public-url', () => ({
  resolveMcpPublicUrl: () => 'http://127.0.0.1:8070/mcp',
}));

const { verifyHostedMcpMock } = vi.hoisted(() => ({
  verifyHostedMcpMock: vi.fn(),
}));

vi.mock('@/lib/mcp-verification', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/mcp-verification.js')>()),
  verifyHostedMcp: verifyHostedMcpMock,
}));

import { verifyHostedMcpAction } from '../../src/app/actions/mcp-verification.js';

describe('verifyHostedMcpAction', () => {
  beforeEach(() => {
    verifyHostedMcpMock.mockReset();
  });

  it('verifies against the configured public MCP URL', async () => {
    verifyHostedMcpMock.mockResolvedValueOnce({
      status: 'verified',
      toolCount: 9,
      agentName: 'Research agent',
      connectionId: 'conn_live',
      contractVersion: '2026-07-12',
    });

    const outcome = await verifyHostedMcpAction({ credential: 'conn_secret' });

    expect(verifyHostedMcpMock).toHaveBeenCalledWith({
      credential: 'conn_secret',
      endpoint: 'http://127.0.0.1:8070/mcp',
    });
    expect(outcome).toEqual({
      ok: true,
      result: {
        status: 'verified',
        toolCount: 9,
        agentName: 'Research agent',
        connectionId: 'conn_live',
        contractVersion: '2026-07-12',
      },
    });
  });

  it('returns a safe failure message without leaking internals', async () => {
    verifyHostedMcpMock.mockRejectedValueOnce(new Error('credential conn_private leaked upstream'));

    const outcome = await verifyHostedMcpAction({ credential: 'conn_secret' });

    expect(outcome).toEqual({
      ok: false,
      message: 'MCP verification failed. Try again.',
    });
  });
});

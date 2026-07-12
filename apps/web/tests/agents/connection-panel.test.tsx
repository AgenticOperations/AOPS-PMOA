import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionPanel } from '../../src/components/agents/ConnectionPanel.js';

const { verifyHostedMcpMock } = vi.hoisted(() => ({
  verifyHostedMcpMock: vi.fn(),
}));

vi.mock('@/lib/mcp-verification', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/mcp-verification.js')>()),
  verifyHostedMcp: verifyHostedMcpMock,
}));

const mcpEndpoint = 'https://mcp.agentops.test/mcp';
const boundaryInstruction = 'Use AOPS before governed tool calls, HTTP operations, or x402 payments. Actions sent outside AOPS are not governed by this connection.';

describe('ConnectionPanel', () => {
  beforeEach(() => {
    verifyHostedMcpMock.mockReset();
  });

  it('reveals the complete hosted MCP setup once for a new credential', () => {
    const remoteConfig = JSON.stringify({
      mcpServers: {
        agentops: {
          type: 'http',
          url: mcpEndpoint,
          headers: { Authorization: 'Bearer conn_test_abc123' },
        },
      },
    }, null, 2);

    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
        connections={[]}
        mcpEndpoint={mcpEndpoint}
        newSecret={{
          connectionName: 'Local Claude',
          secret: 'conn_test_abc123',
        }}
      />,
    );

    expect(screen.getByText('Save this secret now')).toBeInTheDocument();
    expect(screen.getByText('Shown once')).toBeInTheDocument();
    expect(screen.getByText('Local Claude')).toBeInTheDocument();
    expect(screen.getByText('conn_test_abc123')).toBeInTheDocument();
    expect(screen.getByText(mcpEndpoint)).toBeInTheDocument();
    expect(screen.getByText('AGENTOPS_MCP_CREDENTIAL=conn_test_abc123')).toBeInTheDocument();
    expect(screen.getByText(boundaryInstruction)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify MCP connection' })).toBeInTheDocument();
    expect(screen.queryByText(/AGENTOPS_CONNECTION_SECRET=/)).not.toBeInTheDocument();
    const setup = screen.getByTestId('credential-mcp-setup');
    expect(setup.querySelector('.secret-reveal')).toBeNull();
    expect(setup.querySelectorAll('.mcp-setup-code')).toHaveLength(4);
    expect(Array.from(setup.querySelectorAll('.mcp-setup-code')).some((block) => block.textContent === remoteConfig)).toBe(true);
  });

  it('forgets an initial one-time secret after the reveal drawer closes', async () => {
    const user = userEvent.setup();
    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
        connections={[]}
        createAction={async () => ({})}
        mcpEndpoint={mcpEndpoint}
        newSecret={{ connectionName: 'Local Claude', secret: 'conn_test_once' }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Close panel' }));
    await user.click(screen.getByRole('button', { name: 'Create credential' }));

    expect(screen.queryByText('conn_test_once')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Credential name')).toBeInTheDocument();
  });

  it('creates one neutral agent credential without exposing future channel choices', async () => {
    const user = userEvent.setup();
    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
        createAction={async () => ({})}
        connections={[]}
        mcpEndpoint={mcpEndpoint}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Credentials' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create credential' }));
    expect(screen.getByLabelText('Credential name')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Create credential' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Connection type')).not.toBeInTheDocument();
    expect(screen.queryByText('Remote connection')).not.toBeInTheDocument();
    expect(screen.queryByText('Observe only')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('agent_credential')).toBeInTheDocument();
  });

  it('does not dismiss a credential drawer while secret issuance is in flight', async () => {
    let completeAction: ((state: object) => void) | undefined;
    const createAction = async () => new Promise<object>((resolve) => {
      completeAction = resolve;
    });
    const user = userEvent.setup();
    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
        createAction={createAction}
        connections={[]}
        mcpEndpoint={mcpEndpoint}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Create credential' }));
    await user.type(screen.getByLabelText('Credential name'), 'Production worker');
    await user.click(within(screen.getByRole('dialog', { name: 'Create credential' })).getByRole('button', { name: 'Create credential' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close panel' })).toBeDisabled());
    await user.keyboard('{Escape}');

    expect(screen.getByRole('dialog', { name: 'Create credential' })).toBeInTheDocument();
    completeAction?.({});
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close panel' })).toBeEnabled());
  });

  it('does not show plaintext secrets for existing connections', async () => {
    const user = userEvent.setup();
    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
        mcpEndpoint={mcpEndpoint}
        connections={[
          {
            id: 'conn_local',
            agent_id: 'agt_research',
            kind: 'agent_credential',
            name: 'Worker runtime',
            status: 'active',
            secret_last4: '9abc',
            last_tested_at: null,
            last_used_at: null,
            created_at: '2026-07-07T00:00:00.000Z',
          },
        ]}
      />,
    );

    expect(screen.queryByText(/^conn_test_/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText('Ending in 9abc')).toBeInTheDocument();
    expect(screen.getByText('Inspect, rotate, or revoke this runtime credential.')).toBeInTheDocument();
    expect(screen.queryByText('Last tested')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Test' })).not.toBeInTheDocument();
  });

  it('submits action scope through hidden fields instead of requiring per-row function props', async () => {
    const user = userEvent.setup();
    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
        mcpEndpoint={mcpEndpoint}
        rotateAction={async () => ({})}
        revokeAction={async () => ({})}
        connections={[
          {
            id: 'conn_local',
            agent_id: 'agt_research',
            kind: 'agent_credential',
            name: 'Worker runtime',
            status: 'active',
            secret_last4: '9abc',
            last_tested_at: null,
            last_used_at: null,
            created_at: '2026-07-07T00:00:00.000Z',
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Revoke credential' }));
    expect(screen.getAllByDisplayValue('org_acme').length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue('acme-agent-ops').length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue('agt_research').length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue('conn_local').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Confirm revoke' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep credential' })).toBeInTheDocument();
  });

  it('does not expose credential actions for revoked connections', async () => {
    const user = userEvent.setup();
    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
        mcpEndpoint={mcpEndpoint}
        rotateAction={async () => ({})}
        revokeAction={async () => ({})}
        connections={[
          {
            id: 'conn_revoked',
            agent_id: 'agt_research',
            kind: 'agent_credential',
            name: 'Revoked runtime',
            status: 'revoked',
            secret_last4: '9abc',
            last_tested_at: null,
            last_used_at: null,
            created_at: '2026-07-07T00:00:00.000Z',
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getAllByText('Agent credential')).toHaveLength(2);
    expect(screen.getAllByText('Revoked')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Test' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rotate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke credential' })).not.toBeInTheDocument();
  });

  it('reveals the new credential secret after rotation', async () => {
    const user = userEvent.setup();

    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
        mcpEndpoint={mcpEndpoint}
        rotateAction={async () => ({
          secret: {
            connectionName: 'Worker runtime',
            secret: 'conn_rotated_abc123',
          },
        })}
        connections={[
          {
            id: 'conn_local',
            agent_id: 'agt_research',
            kind: 'agent_credential',
            name: 'Worker runtime',
            status: 'active',
            secret_last4: '9abc',
            last_tested_at: null,
            last_used_at: null,
            created_at: '2026-07-07T00:00:00.000Z',
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Rotate' }));
    await user.click(screen.getByRole('button', { name: 'Rotate credential' }));

    expect(await screen.findByText('Save this rotated secret now')).toBeInTheDocument();
    expect(screen.getByText('conn_rotated_abc123')).toBeInTheDocument();
    expect(screen.getByText(mcpEndpoint)).toBeInTheDocument();
    expect(screen.getByText(/Bearer conn_rotated_abc123/)).toBeInTheDocument();
    expect(screen.getByText('AGENTOPS_MCP_CREDENTIAL=conn_rotated_abc123')).toBeInTheDocument();
    expect(screen.getByText(boundaryInstruction)).toBeInTheDocument();
    expect(screen.queryByText(/AGENTOPS_CONNECTION_SECRET=/)).not.toBeInTheDocument();
  });

  it('forgets a rotated secret after the reveal drawer closes', async () => {
    const user = userEvent.setup();

    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
        mcpEndpoint={mcpEndpoint}
        rotateAction={async () => ({
          secret: { connectionName: 'Worker runtime', secret: 'conn_rotated_once' },
        })}
        connections={[{
          id: 'conn_local', agent_id: 'agt_research', kind: 'agent_credential', name: 'Worker runtime',
          status: 'active', secret_last4: '9abc', last_tested_at: null, last_used_at: null,
          created_at: '2026-07-07T00:00:00.000Z',
        }]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Rotate' }));
    await user.click(screen.getByRole('button', { name: 'Rotate credential' }));
    expect(await screen.findByText('conn_rotated_once')).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog', { name: 'Rotate credential' })).getByRole('button', { name: 'Close panel' }));
    await user.click(screen.getByRole('button', { name: 'Rotate' }));

    expect(screen.queryByText('conn_rotated_once')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rotate credential' })).toBeInTheDocument();
  });

  it('does not dismiss a rotation drawer while rotation is in flight', async () => {
    let completeAction: ((state: object) => void) | undefined;
    const rotateAction = async () => new Promise<object>((resolve) => {
      completeAction = resolve;
    });
    const user = userEvent.setup();
    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
        mcpEndpoint={mcpEndpoint}
        rotateAction={rotateAction}
        connections={[{
          id: 'conn_local', agent_id: 'agt_research', kind: 'agent_credential', name: 'Worker runtime',
          status: 'active', secret_last4: '9abc', last_tested_at: null, last_used_at: null,
          created_at: '2026-07-07T00:00:00.000Z',
        }]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Rotate' }));
    await user.click(screen.getByRole('button', { name: 'Rotate credential' }));
    const rotationDialog = screen.getByRole('dialog', { name: 'Rotate credential' });
    await waitFor(() => expect(within(rotationDialog).getByRole('button', { name: 'Close panel' })).toBeDisabled());
    await user.keyboard('{Escape}');

    expect(screen.getByRole('dialog', { name: 'Rotate credential' })).toBeInTheDocument();
    completeAction?.({});
    await waitFor(() => expect(within(rotationDialog).getByRole('button', { name: 'Close panel' })).toBeEnabled());
  });

  it('verifies the exact hosted endpoint and credential and renders the resolved identity', async () => {
    let finishVerification: ((result: {
      status: 'verified';
      toolCount: number;
      agentName: string;
      connectionId: string;
      contractVersion: string;
    }) => void) | undefined;
    verifyHostedMcpMock.mockReturnValueOnce(new Promise((resolve) => {
      finishVerification = resolve;
    }));
    const user = userEvent.setup();

    render(
      <ConnectionPanel
        agentId="agt_research"
        connections={[]}
        mcpEndpoint={mcpEndpoint}
        newSecret={{ connectionName: 'Local Claude', secret: 'conn_verify_once' }}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Verify MCP connection' }));

    expect(verifyHostedMcpMock).toHaveBeenCalledOnce();
    expect(verifyHostedMcpMock).toHaveBeenCalledWith({
      credential: 'conn_verify_once',
      endpoint: mcpEndpoint,
    });
    expect(screen.getByRole('button', { name: 'Verifying...' })).toBeDisabled();

    finishVerification?.({
      status: 'verified',
      toolCount: 8,
      agentName: 'Research agent',
      connectionId: 'conn_live',
      contractVersion: '2026-07-12',
    });

    expect(await screen.findByText('Authenticated')).toBeInTheDocument();
    expect(screen.getByText('8 tools discovered')).toBeInTheDocument();
    expect(screen.getByText('Research agent')).toBeInTheDocument();
    expect(screen.getByText('conn_live')).toBeInTheDocument();
    expect(screen.getByText('2026-07-12')).toBeInTheDocument();
  });

  it('shows a safe verification failure and retries with the same secret', async () => {
    verifyHostedMcpMock
      .mockRejectedValueOnce(new Error('credential conn_private leaked upstream'))
      .mockResolvedValueOnce({
        status: 'verified',
        toolCount: 8,
        agentName: 'Research agent',
        connectionId: 'conn_live',
        contractVersion: '2026-07-12',
      });
    const user = userEvent.setup();

    render(
      <ConnectionPanel
        agentId="agt_research"
        connections={[]}
        mcpEndpoint={mcpEndpoint}
        newSecret={{ connectionName: 'Local Claude', secret: 'conn_retry_once' }}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Verify MCP connection' }));
    expect(await screen.findByText('MCP verification failed. Try again.')).toBeInTheDocument();
    expect(screen.queryByText(/conn_private leaked/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Authenticated')).toBeInTheDocument();
    expect(verifyHostedMcpMock).toHaveBeenCalledTimes(2);
    expect(verifyHostedMcpMock).toHaveBeenLastCalledWith({
      credential: 'conn_retry_once',
      endpoint: mcpEndpoint,
    });
  });

  it('copies each setup value only when its accessible button is clicked', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const secret = 'conn_copy_once';
    const remoteConfig = JSON.stringify({
      mcpServers: {
        agentops: {
          type: 'http',
          url: mcpEndpoint,
          headers: { Authorization: `Bearer ${secret}` },
        },
      },
    }, null, 2);
    render(
      <ConnectionPanel
        agentId="agt_research"
        connections={[]}
        mcpEndpoint={mcpEndpoint}
        newSecret={{ connectionName: 'Local Claude', secret }}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
      />,
    );

    expect(writeText).not.toHaveBeenCalled();
    const copies = [
      ['Copy credential', secret, 'Copied credential'],
      ['Copy endpoint', mcpEndpoint, 'Copied endpoint'],
      ['Copy remote configuration', remoteConfig, 'Copied remote configuration'],
      ['Copy local stdio configuration', `AGENTOPS_MCP_CREDENTIAL=${secret}`, 'Copied local stdio configuration'],
      ['Copy boundary instruction', boundaryInstruction, 'Copied boundary instruction'],
    ] as const;

    for (const [buttonName, value, status] of copies) {
      await user.click(screen.getByRole('button', { name: buttonName }));
      expect(writeText).toHaveBeenLastCalledWith(value);
      expect(screen.getByText(status)).toBeInTheDocument();
    }
    expect(writeText).toHaveBeenCalledTimes(copies.length);
  });

  it('announces when clipboard access is unavailable without throwing', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(
      <ConnectionPanel
        agentId="agt_research"
        connections={[]}
        mcpEndpoint={mcpEndpoint}
        newSecret={{ connectionName: 'Local Claude', secret: 'conn_copy_denied' }}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Copy credential' }));
    expect(await screen.findByText('Copy unavailable')).toBeInTheDocument();
  });
});

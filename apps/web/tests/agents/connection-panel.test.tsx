import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionPanel } from '../../src/components/agents/ConnectionPanel.js';

const { verifyHostedMcpActionMock } = vi.hoisted(() => ({
  verifyHostedMcpActionMock: vi.fn(),
}));

vi.mock('@/app/actions/mcp-verification', () => ({
  verifyHostedMcpAction: verifyHostedMcpActionMock,
}));

const mcpEndpoint = 'https://mcp.agentops.test/mcp';
const boundaryInstruction = 'Use AOPS before governed tool calls, HTTP operations, or x402 payments. Call the matching check tool first, follow approval requirements, and record the final outcome. Actions sent outside AOPS are not governed by this connection.';
const claudeCodeConfig = `{
  "mcpServers": {
    "agentops": {
      "type": "http",
      "url": "${mcpEndpoint}",
      "headers": {
        "Authorization": "Bearer \${AGENTOPS_MCP_CREDENTIAL}"
      }
    }
  }
}`;
const codexCommand = `codex mcp add agentops --url ${mcpEndpoint} --bearer-token-env-var AGENTOPS_MCP_CREDENTIAL`;
const paidHttpExample = `{
  "name": "agentops.payment_x402",
  "arguments": {
    "idempotency_key": "report-2026-07-13-001",
    "request": {
      "url": "https://api.example.com/reports",
      "method": "POST",
      "headers": [["content-type", "application/json"], ["accept", "application/json"]],
      "body": {"kind": "json", "value": {"range": "30d"}}
    }
  }
}`;

function localAdapterConfig(secret: string): string {
  return `AGENTOPS_API_BASE_URL=http://localhost:8080 AGENTOPS_MCP_CREDENTIAL=${secret} npm run dev:mcp`;
}

describe('ConnectionPanel', () => {
  beforeEach(() => {
    verifyHostedMcpActionMock.mockReset();
  });

  it('reveals the complete hosted MCP setup once for a new credential', () => {
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
    expect(screen.getByRole('heading', { name: 'Claude Code' })).toBeInTheDocument();
    expect(screen.getByText('Keep project configuration secret-free. Set AGENTOPS_MCP_CREDENTIAL in the host environment.')).toBeInTheDocument();
    const claudeSection = screen.getByRole('heading', { name: 'Claude Code' }).closest('section');
    expect(claudeSection?.querySelector('pre')?.textContent).toBe(claudeCodeConfig);
    expect(claudeSection?.textContent).not.toContain('conn_test_abc123');
    expect(screen.getByRole('heading', { name: 'Codex CLI' })).toBeInTheDocument();
    expect(screen.getByText(codexCommand)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Local repository adapter' })).toBeInTheDocument();
    expect(screen.getByText('Requires a BUILD-PMOA checkout. Run this command from the repository root.')).toBeInTheDocument();
    const localSection = screen.getByRole('heading', { name: 'Local repository adapter' }).closest('section');
    expect(localSection?.querySelector('pre')?.textContent).toBe(localAdapterConfig('conn_test_abc123'));
    expect(screen.getByText(boundaryInstruction)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify MCP connection' })).toBeInTheDocument();
    expect(screen.queryByText(/AGENTOPS_CONNECTION_SECRET=/)).not.toBeInTheDocument();
    const setup = screen.getByTestId('credential-mcp-setup');
    expect(setup.querySelector('.secret-reveal')).toBeNull();
    expect(setup.querySelectorAll('.mcp-setup-code')).toHaveLength(6);
    expect(screen.queryByRole('heading', { name: 'Remote JSON configuration' })).not.toBeInTheDocument();
  });

  it('documents one secret-free governed paid HTTP call and same-key replay behavior without another action', () => {
    render(
      <ConnectionPanel
        agentId="agt_research"
        connections={[]}
        mcpEndpoint={mcpEndpoint}
        newSecret={{ connectionName: 'Local Claude', secret: 'conn_guide_secret' }}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
      />,
    );

    const guide = screen.getByRole('heading', { name: 'Governed paid HTTP' }).closest('section');
    expect(guide).not.toBeNull();
    expect(guide?.querySelectorAll('pre')).toHaveLength(1);
    expect(guide?.querySelector('pre')?.textContent).toBe(paidHttpExample);
    expect(guide).toHaveTextContent(`public hosted MCP endpoint ${mcpEndpoint}`);
    expect(guide).toHaveTextContent('Bearer ${AGENTOPS_MCP_CREDENTIAL}');
    expect(guide).not.toHaveTextContent('conn_guide_secret');
    expect(guide).toHaveTextContent('retry this exact request with the same idempotency_key');
    expect(guide).toHaveTextContent('without paying again');
    expect(guide).toHaveTextContent('submitting or unknown');
    expect(within(guide as HTMLElement).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /import|open console/i })).not.toBeInTheDocument();
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
    const rotatedClaudeSection = screen.getByRole('heading', { name: 'Claude Code' }).closest('section');
    expect(rotatedClaudeSection?.querySelector('pre')?.textContent).toBe(claudeCodeConfig);
    expect(rotatedClaudeSection?.textContent).not.toContain('conn_rotated_abc123');
    expect(screen.getByText(codexCommand)).toBeInTheDocument();
    const rotatedLocalSection = screen.getByRole('heading', { name: 'Local repository adapter' }).closest('section');
    expect(rotatedLocalSection?.querySelector('pre')?.textContent).toBe(localAdapterConfig('conn_rotated_abc123'));
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

  it('verifies the credential through the server action and renders the resolved identity', async () => {
    let finishVerification: ((result: {
      ok: true;
      result: {
        status: 'verified';
        toolCount: number;
        agentName: string;
        connectionId: string;
        contractVersion: string;
      };
    }) => void) | undefined;
    verifyHostedMcpActionMock.mockReturnValueOnce(new Promise((resolve) => {
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

    expect(verifyHostedMcpActionMock).toHaveBeenCalledOnce();
    expect(verifyHostedMcpActionMock).toHaveBeenCalledWith({ credential: 'conn_verify_once' });
    expect(screen.getByRole('button', { name: 'Verifying...' })).toBeDisabled();

    finishVerification?.({
      ok: true,
      result: {
        status: 'verified',
        toolCount: 8,
        agentName: 'Research agent',
        connectionId: 'conn_live',
        contractVersion: '2026-07-12',
      },
    });

    expect(await screen.findByText('Authenticated')).toBeInTheDocument();
    expect(screen.getByText('8 tools discovered')).toBeInTheDocument();
    expect(screen.getByText('Research agent')).toBeInTheDocument();
    expect(screen.getByText('conn_live')).toBeInTheDocument();
    expect(screen.getByText('2026-07-12')).toBeInTheDocument();
  });

  it('shows a safe verification failure and retries with the same secret', async () => {
    verifyHostedMcpActionMock
      .mockResolvedValueOnce({ ok: false, message: 'MCP verification failed. Try again.' })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          status: 'verified',
          toolCount: 8,
          agentName: 'Research agent',
          connectionId: 'conn_live',
          contractVersion: '2026-07-12',
        },
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

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Authenticated')).toBeInTheDocument();
    expect(verifyHostedMcpActionMock).toHaveBeenCalledTimes(2);
    expect(verifyHostedMcpActionMock).toHaveBeenLastCalledWith({ credential: 'conn_retry_once' });
  });

  it('copies each setup value only when its accessible button is clicked', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const secret = 'conn_copy_once';
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
      ['Copy Claude Code configuration', claudeCodeConfig, 'Copied Claude Code configuration'],
      ['Copy Codex CLI command', codexCommand, 'Copied Codex CLI command'],
      ['Copy local repository adapter', localAdapterConfig(secret), 'Copied local repository adapter'],
      ['Copy boundary instruction', boundaryInstruction, 'Copied boundary instruction'],
    ] as const;

    for (const [buttonName, value, status] of copies) {
      await user.click(screen.getByRole('button', { name: buttonName }));
      expect(writeText).toHaveBeenLastCalledWith(value);
      expect(await screen.findByText(status)).toBeInTheDocument();
    }
    expect(writeText).toHaveBeenCalledTimes(copies.length);
  });

  it('re-announces a repeated copy through observable content changes in one live-region node', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(
      <ConnectionPanel
        agentId="agt_research"
        connections={[]}
        mcpEndpoint={mcpEndpoint}
        newSecret={{ connectionName: 'Local Claude', secret: 'conn_copy_repeat' }}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Copy endpoint' }));
    await screen.findByText('Copied endpoint');
    const liveRegion = document.querySelector('.mcp-copy-status');
    expect(liveRegion).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Copy endpoint' }));

    expect(document.querySelector('.mcp-copy-status')).toBe(liveRegion);
    expect(liveRegion).toHaveTextContent('');
    await screen.findByText('Copied endpoint');
    expect(document.querySelector('.mcp-copy-status')).toBe(liveRegion);
  });

  it('ignores an in-flight verification result after the setup unmounts', async () => {
    let finishVerification: ((result: {
      ok: true;
      result: {
        status: 'verified';
        toolCount: number;
        agentName: string;
        connectionId: string;
        contractVersion: string;
      };
    }) => void) | undefined;
    verifyHostedMcpActionMock.mockReturnValueOnce(new Promise((resolve) => {
      finishVerification = resolve;
    }));
    const user = userEvent.setup();
    const view = render(
      <ConnectionPanel
        agentId="agt_research"
        connections={[]}
        mcpEndpoint={mcpEndpoint}
        newSecret={{ connectionName: 'Local Claude', secret: 'conn_abort_unmount' }}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Verify MCP connection' }));
    view.unmount();
    finishVerification?.({
      ok: true,
      result: {
        status: 'verified',
        toolCount: 8,
        agentName: 'Research agent',
        connectionId: 'conn_live',
        contractVersion: '2026-07-12',
      },
    });
    expect(screen.queryByText('Authenticated')).not.toBeInTheDocument();
  });

  it('resets verification when the revealed secret changes', async () => {
    verifyHostedMcpActionMock.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    const view = render(
      <ConnectionPanel
        agentId="agt_research"
        connections={[]}
        mcpEndpoint={mcpEndpoint}
        newSecret={{ connectionName: 'Local Claude', secret: 'conn_abort_old' }}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Verify MCP connection' }));
    view.rerender(
      <ConnectionPanel
        agentId="agt_research"
        connections={[]}
        mcpEndpoint={mcpEndpoint}
        newSecret={{ connectionName: 'Replacement', secret: 'conn_abort_new' }}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
      />,
    );

    expect(screen.getByRole('button', { name: 'Verify MCP connection' })).toBeInTheDocument();
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

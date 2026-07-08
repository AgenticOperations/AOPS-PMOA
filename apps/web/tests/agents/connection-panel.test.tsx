import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConnectionPanel } from '../../src/components/agents/ConnectionPanel.js';

describe('ConnectionPanel', () => {
  it('reveals a new connection secret once in a dedicated setup block', () => {
    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
        connections={[]}
        newSecret={{
          connectionName: 'Local Claude',
          secret: 'conn_test_abc123',
        }}
      />,
    );

    expect(screen.getByText('Save this secret now')).toBeInTheDocument();
    expect(screen.getByText('conn_test_abc123')).toBeInTheDocument();
    expect(screen.getByText(/AGENTOPS_CONNECTION_SECRET=conn_test_abc123/)).toBeInTheDocument();
  });

  it('creates one neutral agent credential without exposing future channel choices', () => {
    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
        createAction={async () => ({})}
        connections={[]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Access credential' })).toBeInTheDocument();
    expect(screen.getByLabelText('Credential name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create credential' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Connection type')).not.toBeInTheDocument();
    expect(screen.queryByText('Remote connection')).not.toBeInTheDocument();
    expect(screen.queryByText('Observe only')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('agent_credential')).toBeInTheDocument();
  });

  it('does not show plaintext secrets for existing connections', () => {
    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
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
    expect(screen.getByText('ending in 9abc')).toBeInTheDocument();
  });

  it('submits action scope through hidden fields instead of requiring per-row function props', () => {
    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
        testAction={async () => ({})}
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

    expect(screen.getAllByDisplayValue('org_acme').length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue('acme-agent-ops').length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue('agt_research').length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue('conn_local').length).toBeGreaterThan(0);
  });

  it('shows a clean credential test result instead of relying on the server action payload', async () => {
    const user = userEvent.setup();

    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
        testAction={async () => ({ message: 'Credential test passed.' })}
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

    await user.click(screen.getByRole('button', { name: 'Test' }));

    expect(await screen.findByText('Credential test passed.')).toBeInTheDocument();
  });

  it('does not expose credential actions for revoked connections', () => {
    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
        testAction={async () => ({})}
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

    expect(screen.getByText('Agent credential / Revoked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Test' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rotate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('reveals the new credential secret after rotation', async () => {
    const user = userEvent.setup();

    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
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

    await user.click(screen.getByRole('button', { name: 'Rotate' }));

    expect(await screen.findByText('Save this rotated secret now')).toBeInTheDocument();
    expect(screen.getByText('conn_rotated_abc123')).toBeInTheDocument();
    expect(screen.getByText(/AGENTOPS_CONNECTION_SECRET=conn_rotated_abc123/)).toBeInTheDocument();
  });
});

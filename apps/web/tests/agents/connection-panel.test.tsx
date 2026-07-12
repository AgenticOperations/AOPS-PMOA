import { render, screen, waitFor, within } from '@testing-library/react';
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

  it('forgets an initial one-time secret after the reveal drawer closes', async () => {
    const user = userEvent.setup();
    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
        connections={[]}
        createAction={async () => ({})}
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
  });

  it('submits action scope through hidden fields instead of requiring per-row function props', async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getAllByDisplayValue('org_acme').length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue('acme-agent-ops').length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue('agt_research').length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue('conn_local').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Revoke credential' }));
    expect(screen.getByRole('button', { name: 'Confirm revoke' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep credential' })).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Test' }));

    expect(await screen.findByText('Credential test passed.')).toBeInTheDocument();
  });

  it('does not expose credential actions for revoked connections', async () => {
    const user = userEvent.setup();
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
    expect(screen.getByText(/AGENTOPS_CONNECTION_SECRET=conn_rotated_abc123/)).toBeInTheDocument();
  });

  it('forgets a rotated secret after the reveal drawer closes', async () => {
    const user = userEvent.setup();

    render(
      <ConnectionPanel
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agentId="agt_research"
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
});

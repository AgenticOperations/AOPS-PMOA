import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AgentDetailShell, type AgentDetailTab } from '../../src/components/agents/AgentDetailShell.js';
import type { AgentDetail } from '../../src/lib/identity-spine-types.js';

const baseAgent: AgentDetail = {
  id: 'agt_research',
  name: 'Research agent',
  status: 'active',
  labels: ['research'],
  description: 'Reads sources and drafts summaries',
  default_environment: 'dev',
  metadata: {},
  team: { id: 'team_default', name: 'Default' },
  parent: null,
  children: [],
  connection_health: 'healthy',
  wallet_refs_count: 0,
};

function renderDetail(
  activeTab: AgentDetailTab = 'overview',
  options: {
    readonly createConnection?: NonNullable<
      NonNullable<Parameters<typeof AgentDetailShell>[0]['actions']>['createConnection']
    >;
  } = {},
) {
  return render(
    <AgentDetailShell
      activeTab={activeTab}
      orgId="org_acme"
      orgSlug="acme-agent-ops"
      mcpEndpoint="https://mcp.agentops.test/mcp"
      agent={baseAgent}
      connections={[
        {
          id: 'conn_local',
          agent_id: 'agt_research',
          kind: 'agent_credential',
          name: 'Local Claude',
          status: 'active',
          secret_last4: '9abc',
          last_tested_at: null,
          last_used_at: null,
          created_at: '2026-07-07T00:00:00.000Z',
        },
      ]}
      walletRefs={[]}
      activity={[
        {
          id: 'aud_1',
          action: 'connection.rotated',
          eventType: 'connection.rotated',
          outcome: 'success',
          recordedAt: '2026-07-07T00:00:00.000Z',
          actorType: 'user',
          actorId: 'usr_operator',
          eventDomain: 'credential',
          eventCategory: 'configuration',
          severity: 'info',
          summary: 'Credential rotated',
          subject: 'Local Claude',
          description: 'Credential changed from 3def to 9abc',
          tags: ['section_1', 'agent', 'credential'],
        },
      ]}
      activityFeed={{
        live: {
          active_connection_count: 1,
          latest_event_at: '2026-07-07T16:29:23.055Z',
          last_seen_at: '2026-07-07T16:29:23.055Z',
          status: 'active',
        },
        events: [
          {
            id: 'act_runtime',
            action: 'runtime.check',
            approvalId: null,
            category: 'runtime',
            connectionId: 'conn_live',
            decisionId: 'pdec_allow',
            description: 'allow for runtime.http.request',
            occurredAt: '2026-07-07T16:29:23.055Z',
            outcome: 'success',
            payload: { action: 'runtime.http.request', decision: 'allow' },
            source: 'activity',
            subject: 'runtime.http.request',
            summary: 'Runtime check allow',
          },
        ],
      }}
      policies={[
        {
          id: 'pol_weather',
          version: 1,
          name: 'Deny weather API',
          description: 'Blocks weather API requests.',
          category: 'operational',
          binding: {
            id: 'pbind_weather',
            scope: 'direct',
            target_id: 'agt_research',
            target_type: 'agent',
            target_label: 'Research agent',
          },
        },
        {
          id: 'pol_paid_data',
          version: 1,
          name: 'Approve paid market data',
          description: 'Requires approval for high-value x402 checks.',
          category: 'operational',
          binding: {
            id: 'pbind_workspace',
            scope: 'workspace',
            target_id: 'org_acme',
            target_type: 'org',
            target_label: 'Acme Workspace',
          },
        },
      ]}
      availablePolicies={[
        {
          id: 'pol_tool_limit',
          version: 1,
          name: 'Limit risky tools',
          description: 'Observe risky tool calls.',
          category: 'operational',
          status: 'active',
          binding_target_types: ['agent'],
          bindings: [],
          bindings_count: 0,
          created_at: '2026-07-07T00:00:00.000Z',
        },
      ]}
      allowedActions={[
        {
          action: 'tool.call',
          label: 'browser.search',
          decision: 'deny',
          policyName: 'Deny browser search',
        },
      ]}
      blockedOperations={[
        {
          id: 'opdec_browser',
          action: 'tool.call',
          agent_id: 'agt_research',
          connection_id: 'conn_local',
          decision: 'deny',
          reasonCode: 'policy_denied',
          explanation: 'A policy denied this request.',
          tool_name: 'browser.search',
          resource_label: null,
          created_at: '2026-07-07T16:29:23.055Z',
        },
      ]}
      actions={{
        bindPolicy: async () => {},
        createConnection: options.createConnection,
        removePolicyBinding: async () => {},
        updateAgent: async () => {},
      }}
    />,
  );
}

describe('AgentDetailShell', () => {
  it('shows overview by default and links to all detail sections', () => {
    renderDetail();

    expect(screen.getByRole('heading', { name: 'Research agent' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Overview/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Policies & access/ })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/agents/agt_research?tab=access',
    );
    expect(screen.getByRole('heading', { name: 'Identity details' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lifecycle' })).toBeInTheDocument();
    expect(screen.queryByDisplayValue('research')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit agent' }));
    expect(screen.getByRole('dialog', { name: 'Edit agent' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('research')).toBeInTheDocument();
    expect(screen.getByDisplayValue('dev')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Access credential' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Live activity' })).not.toBeInTheDocument();
  });

  it('shows credentials and wallet references only in the credentials tab', () => {
    renderDetail('credentials');

    expect(screen.getByRole('link', { name: /Credentials & wallets/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Credentials' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wallet references' })).toBeInTheDocument();
    expect(screen.getByText('No wallet references')).toBeInTheDocument();
    expect(screen.getAllByText('Local Claude').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Configuration history' })).not.toBeInTheDocument();
  });

  it('threads the page-facing hosted MCP endpoint into one-time credential setup', async () => {
    const user = userEvent.setup();
    renderDetail('credentials', {
      createConnection: async () => ({
        secret: {
          connectionName: 'Hosted runtime',
          secret: 'conn_page_threaded',
        },
      }),
    });

    await user.click(screen.getByRole('button', { name: 'Create credential' }));
    await user.type(screen.getByLabelText('Credential name'), 'Hosted runtime');
    await user.click(within(screen.getByRole('dialog', { name: 'Create credential' })).getByRole('button', { name: 'Create credential' }));

    expect(await screen.findByText('https://mcp.agentops.test/mcp')).toBeInTheDocument();
    expect(screen.getByText(/Bearer conn_page_threaded/)).toBeInTheDocument();
  });

  it('shows recent runtime evidence separately from on-demand live monitoring and configuration history', () => {
    renderDetail('activity');

    expect(screen.getByRole('heading', { name: 'Agent activity' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open live monitor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Runtime history' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Runtime check allow')).toBeInTheDocument();
    expect(screen.queryByText('Credential rotated')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Configuration history' }));
    expect(screen.getByRole('button', { name: 'Configuration history' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Credential rotated')).toBeInTheDocument();
    expect(screen.queryByText('Runtime check allow')).not.toBeInTheDocument();
    expect(screen.queryByText('connection.rotated')).not.toBeInTheDocument();
    expect(screen.queryByText('connection.tested')).not.toBeInTheDocument();
    expect(screen.queryByText('conn_local')).not.toBeInTheDocument();
  });

  it('shows effective policies and operational access in the access tab', () => {
    renderDetail('access');

    expect(screen.getByRole('heading', { name: 'Effective policies' })).toBeInTheDocument();
    expect(screen.getByText('Deny weather API')).toBeInTheDocument();
    expect(screen.getByText('Approve paid market data')).toBeInTheDocument();
    expect(screen.getByText('Direct')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach policy' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Attach policy' }));
    expect(screen.getByRole('option', { name: 'Limit risky tools · v1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(screen.getByText('Inherited policies')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Operational access' })).toBeInTheDocument();
    expect(screen.getByText('browser.search')).toBeInTheDocument();
    expect(screen.getByText('Deny browser search')).toBeInTheDocument();
    expect(screen.getByText('Recent blocks')).toBeInTheDocument();
    expect(screen.getByText('policy_denied')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Credentials' })).not.toBeInTheDocument();
  });
});

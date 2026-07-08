import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentDetailShell } from '../../src/components/agents/AgentDetailShell.js';

describe('AgentDetailShell', () => {
  it('keeps identity, connection, and configuration history surfaces separate', () => {
    render(
      <AgentDetailShell
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agent={{
          id: 'agt_research',
          name: 'Research agent',
          status: 'paused',
          labels: ['research'],
          description: 'Reads sources and drafts summaries',
          default_environment: 'dev',
          metadata: {},
          team: { id: 'team_default', name: 'Default' },
          parent: null,
          children: [],
          connection_health: 'stale',
          wallet_refs_count: 0,
        }}
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
      />,
    );

    expect(screen.getByRole('heading', { name: 'Research agent' })).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByText('Access credential')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Configuration history' })).toBeInTheDocument();
    expect(screen.getByText('Credential rotated')).toBeInTheDocument();
    expect(screen.getAllByText('Local Claude')).toHaveLength(2);
    expect(screen.getByText('Credential changed from 3def to 9abc')).toBeInTheDocument();
    expect(screen.queryByText('connection.rotated')).not.toBeInTheDocument();
    expect(screen.queryByText('connection.tested')).not.toBeInTheDocument();
    expect(screen.queryByText('conn_local')).not.toBeInTheDocument();
    expect(screen.getByText('Credential')).toBeInTheDocument();
    expect(screen.queryByText('Configuration')).not.toBeInTheDocument();
    expect(screen.queryByText('Wallet references')).not.toBeInTheDocument();
    expect(screen.queryByText('Wallet refs')).not.toBeInTheDocument();
    expect(screen.queryByText('Managed wallet')).not.toBeInTheDocument();
    expect(screen.queryByText('Environment')).not.toBeInTheDocument();
    expect(screen.queryByText('Default environment')).not.toBeInTheDocument();
    expect(screen.queryByText('Labels')).not.toBeInTheDocument();
  });

  it('shows live runtime activity separately from configuration history', () => {
    render(
      <AgentDetailShell
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agent={{
          id: 'agt_research',
          name: 'Research agent',
          status: 'active',
          labels: [],
          description: '',
          default_environment: null,
          metadata: {},
          team: { id: 'team_default', name: 'Default' },
          parent: null,
          children: [],
          connection_health: 'healthy',
          wallet_refs_count: 0,
        }}
        connections={[]}
        activity={[]}
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
      />,
    );

    expect(screen.getByRole('heading', { name: 'Live activity' })).toBeInTheDocument();
    expect(screen.getByText('Live now')).toBeInTheDocument();
    expect(screen.getByText('Runtime check allow')).toBeInTheDocument();
    expect(screen.getByText('allow for runtime.http.request')).toBeInTheDocument();
    expect(screen.getByText('runtime.http.request')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Configuration history' })).toBeInTheDocument();
  });

  it('shows effective policies attached to the agent', () => {
    render(
      <AgentDetailShell
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        agent={{
          id: 'agt_research',
          name: 'Research agent',
          status: 'active',
          labels: [],
          description: '',
          default_environment: null,
          metadata: {},
          team: { id: 'team_default', name: 'Default' },
          parent: null,
          children: [],
          connection_health: 'healthy',
          wallet_refs_count: 0,
        }}
        connections={[]}
        activity={[]}
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
      />,
    );

    expect(screen.getByRole('heading', { name: 'Policies' })).toBeInTheDocument();
    expect(screen.getByText('Deny weather API')).toBeInTheDocument();
    expect(screen.getByText('Approve paid market data')).toBeInTheDocument();
    expect(screen.getByText('Direct')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Operational access' })).toBeInTheDocument();
    expect(screen.getByText('browser.search')).toBeInTheDocument();
    expect(screen.getByText('Deny browser search')).toBeInTheDocument();
    expect(screen.getByText('Recent blocks')).toBeInTheDocument();
    expect(screen.getByText('policy_denied')).toBeInTheDocument();
  });
});

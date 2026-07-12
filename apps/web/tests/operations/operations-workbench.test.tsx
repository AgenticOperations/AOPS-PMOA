import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OperationsWorkbench } from '../../src/components/operations/OperationsWorkbench.js';

describe('OperationsWorkbench', () => {
  it('refreshes the open rate-limit editor when persisted status changes', () => {
    const rateLimit = {
      id: 'oprl_1',
      org_id: 'org_1',
      target_type: 'agent' as const,
      target_id: 'agt_research',
      action: 'tool.call' as const,
      bucket: 'tool:browser.search',
      limit: 2,
      window_seconds: 60,
      status: 'active' as const,
      created_at: '2026-07-08T08:00:00.000Z',
      utilization: {
        current_bucket: '2026-07-08T08:00:00.000Z',
        current_count: 1,
        current_window_start: '2026-07-08T08:00:00.000Z',
      },
    };
    const actions = {
      archiveToolAction: async () => {},
      disableRateLimitAction: async () => {},
      importAction: async () => {},
      rateLimitAction: async () => {},
      updateRateLimitAction: async () => {},
      updateToolAction: async () => {},
    };
    const { rerender } = render(
      <OperationsWorkbench
        agents={[{ id: 'agt_research', name: 'Research agent' }]}
        decisions={[]}
        rateLimits={[rateLimit]}
        tools={[]}
        {...actions}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Rate limits' }));
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(screen.getByLabelText('Status')).toHaveValue('active');
    fireEvent.click(screen.getByRole('button', { name: 'Disable limit' }));
    expect(screen.getByRole('button', { name: 'Confirm disable' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep active' })).toBeInTheDocument();

    rerender(
      <OperationsWorkbench
        agents={[{ id: 'agt_research', name: 'Research agent' }]}
        decisions={[]}
        rateLimits={[{ ...rateLimit, status: 'disabled' }]}
        tools={[]}
        {...actions}
      />,
    );

    expect(screen.getByLabelText('Status')).toHaveValue('disabled');
  });

  it('keeps tools, limits, and runtime decisions in focused source-backed views', () => {
    render(
      <OperationsWorkbench
        agents={[{ id: 'agt_research', name: 'Research agent' }]}
        decisions={[
          {
            id: 'opdec_allowed',
            action: 'runtime.http.request',
            agent_id: 'agt_research',
            connection_id: 'conn_local',
            policyDecisionId: 'pdec_allow',
            approvalId: null,
            decision: 'allow',
            reasonCode: 'no_matching_policy',
            explanation: 'No matching policy changed the default allow decision.',
            matched: [],
            tool_name: null,
            tool_risk_level: null,
            resource_label: 'api.market.test',
            resource_domain: 'api.market.test',
            resource_category: 'market-data',
            context: { resource: { domain: 'api.market.test', category: 'market-data' } },
            created_at: '2026-07-08T08:01:00.000Z',
          },
          {
            id: 'opdec_weather',
            action: 'runtime.http.request',
            agent_id: 'agt_research',
            connection_id: 'conn_local',
            policyDecisionId: 'pdec_deny',
            approvalId: null,
            decision: 'deny',
            reasonCode: 'policy_denied',
            explanation: 'A policy denied this request.',
            matched: [],
            tool_name: null,
            tool_risk_level: null,
            resource_label: 'api.weather.test',
            resource_domain: 'api.weather.test',
            resource_category: 'weather',
            context: { resource: { domain: 'api.weather.test', category: 'weather' } },
            created_at: '2026-07-08T08:00:00.000Z',
          },
        ]}
        archiveToolAction={async () => {}}
        disableRateLimitAction={async () => {}}
        importAction={async () => {}}
        rateLimits={[
          {
            id: 'oprl_1',
            org_id: 'org_1',
            target_type: 'agent',
            target_id: 'agt_research',
            action: 'runtime.http.request',
            bucket: 'default',
            limit: 20,
            window_seconds: 60,
            status: 'active',
            created_at: '2026-07-08T08:00:00.000Z',
            utilization: {
              current_bucket: '2026-07-08T08:00:00.000Z',
              current_count: 3,
              current_window_start: '2026-07-08T08:00:00.000Z',
            },
          },
        ]}
        rateLimitAction={async () => {}}
        tools={[
          {
            id: 'tool_browser',
            org_id: 'org_1',
            name: 'browser.search',
            display_name: 'Browser search',
            category: 'browser',
            risk_level: 'low',
            description: 'Managed search tool',
            source: 'import',
            status: 'active',
            metadata: {},
            created_at: '2026-07-08T08:00:00.000Z',
            updated_at: '2026-07-08T08:00:00.000Z',
          },
        ]}
        updateRateLimitAction={async () => {}}
        updateToolAction={async () => {}}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Operations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tool catalog' })).toBeInTheDocument();
    expect(screen.getByText('browser.search')).toBeInTheDocument();
    expect(screen.getByText('Managed search tool')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import tool' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Rate limits' }));
    expect(screen.getByRole('heading', { name: 'Rate limits' })).toBeInTheDocument();
    expect(screen.getByText('3/20')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create limit' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Decisions' }));
    expect(screen.getByRole('heading', { name: 'Runtime decisions' })).toBeInTheDocument();
    expect(screen.getByText('api.market.test')).toBeInTheDocument();
    expect(screen.getByText('api.weather.test')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'deny' } });
    expect(screen.queryByText('api.market.test')).not.toBeInTheDocument();
    expect(screen.getByText('api.weather.test')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Blocked actions' })).not.toBeInTheDocument();

    expect(screen.queryByRole('tab', { name: 'Sessions' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Tool catalog' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect browser.search' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save tool' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive tool' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive tool' }));
    expect(screen.getByRole('button', { name: 'Confirm archive' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep tool' })).toBeInTheDocument();

    expect(screen.queryByText(/wallet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/treasury/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/marketplace/i)).not.toBeInTheDocument();
  });
});

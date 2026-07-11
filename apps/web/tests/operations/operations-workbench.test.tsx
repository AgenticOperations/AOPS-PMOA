import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OperationsWorkbench } from '../../src/components/operations/OperationsWorkbench.js';

describe('OperationsWorkbench', () => {
  it('shows tool catalog and blocked operational actions without finance placeholders', () => {
    render(
      <OperationsWorkbench
        agents={[{ id: 'agt_research', name: 'Research agent' }]}
        blocked={[
          {
            id: 'opdec_weather',
            action: 'runtime.http.request',
            agent_id: 'agt_research',
            connection_id: 'conn_local',
            decision: 'deny',
            reasonCode: 'policy_denied',
            explanation: 'A policy denied this request.',
            tool_name: null,
            resource_label: 'api.weather.test',
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
    expect(screen.getByRole('heading', { name: 'Blocked actions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rate limits' })).toBeInTheDocument();
    expect(screen.getByText('3/20')).toBeInTheDocument();
    expect(screen.getByText('api.weather.test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import tool' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create limit' })).toBeInTheDocument();
    expect(screen.queryByText(/wallet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/treasury/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/marketplace/i)).not.toBeInTheDocument();
  });
});

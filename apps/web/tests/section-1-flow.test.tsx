import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HomePage from '../src/app/page.js';
import AuthPage from '../src/app/auth/page.js';
import OnboardingPage from '../src/app/onboarding/page.js';
import AgentsPage from '../src/app/app/[orgSlug]/agents/page.js';
import OverviewPage from '../src/app/app/[orgSlug]/overview/page.js';
import {
  getCurrentSession,
  getOrgBySlug,
  listAgents,
  listAgentsPage,
  listTeams,
} from '@/lib/server/identity-spine-client.js';
import { listApprovals } from '@/lib/server/approval-client.js';
import { listAuditEvents } from '@/lib/server/audit-client.js';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/server/identity-spine-client.js', () => ({
  getCurrentSession: vi.fn(),
  getOrgBySlug: vi.fn(),
  listAgents: vi.fn(),
  listAgentsPage: vi.fn(),
  listTeams: vi.fn(),
}));

vi.mock('@/lib/server/approval-client.js', () => ({
  listApprovals: vi.fn(),
}));

vi.mock('@/lib/server/audit-client.js', () => ({
  listAuditEvents: vi.fn(),
}));

vi.mock('@/lib/server/payments-client.js', () => ({
  getTreasuryOverview: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/server/mcp-public-url.js', () => ({
  resolveMcpPublicUrl: vi.fn().mockReturnValue('http://127.0.0.1:8070/mcp'),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  usePathname: () => '/app/acme-agent-ops/overview',
  useRouter: () => ({ push: vi.fn() }),
}));

describe('Section 1 product flow', () => {
  it('keeps root public and sends users to auth instead of public org creation', async () => {
    render(await HomePage());

    expect(screen.getByRole('heading', { name: 'Let agents act. Keep authority.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request access' })).toHaveAttribute('href', '/auth');
    expect(screen.queryByRole('button', { name: 'Create organization' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Switch to dark theme/i })).not.toBeInTheDocument();
  });

  it('shows Google sign-in on auth when no session exists', async () => {
    vi.mocked(getCurrentSession).mockResolvedValueOnce(null);

    const { container } = render(await AuthPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('heading', { name: 'Sign in to agentOps' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/api/auth/google/start',
    );
    expect(screen.getByLabelText('agentOps activation path')).toBeInTheDocument();
    expect(
      screen.getByText('Let your agents operate with a strict functional control harness.'),
    ).toBeInTheDocument();
    expect(container.querySelector('source[src="/AuthVideo.mp4"]')).not.toBeNull();
    expect(screen.queryByText('Join agentOps')).not.toBeInTheDocument();
    expect(screen.queryByText('Register your identity')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Setup progress')).not.toBeInTheDocument();
    expect(screen.queryByText('Policy checks')).not.toBeInTheDocument();
    expect(screen.queryByText('Google verifies the operator')).not.toBeInTheDocument();
    expect(screen.queryByText('Secure access')).not.toBeInTheDocument();
    expect(screen.queryByText('A WISE QUOTE')).not.toBeInTheDocument();
    expect(screen.queryByText(/Get Everything/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Forgot Password/i)).not.toBeInTheDocument();
    expect(screen.queryByText('G')).not.toBeInTheDocument();
    expect(screen.getByTestId('google-logo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Switch to dark theme/ })).toBeInTheDocument();
    expect(screen.queryByText(/Section 1/i)).not.toBeInTheDocument();
  });

  it('shows OAuth recovery copy when Google sign-in fails', async () => {
    vi.mocked(getCurrentSession).mockResolvedValueOnce(null);

    render(await AuthPage({ searchParams: Promise.resolve({ error: 'oauth_exchange' }) }));

    expect(screen.getByRole('alert')).toHaveTextContent('Google sign-in could not be completed');
    expect(screen.getByRole('link', { name: 'Try Google again' })).toHaveAttribute(
      'href',
      '/api/auth/google/start',
    );
  });

  it('shows account choice before onboarding when a signed-in user has no organizations', async () => {
    vi.mocked(getCurrentSession).mockResolvedValueOnce({
      user: { id: 'usr_owner', email: 'owner@example.test', name: 'Owner User' },
      orgs: [],
    });

    render(await AuthPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('heading', { name: 'Continue setup' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue as owner@example.test' })).toHaveAttribute(
      'href',
      '/onboarding',
    );
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/api/auth/google/start',
    );
    expect(screen.getByLabelText('agentOps activation path')).toBeInTheDocument();
  });

  it('shows workspace cards for signed-in users with organizations', async () => {
    vi.mocked(getCurrentSession).mockResolvedValueOnce({
      user: { id: 'usr_owner', email: 'owner@example.test', name: 'Owner User' },
      orgs: [
        {
          id: 'org_acme',
          name: 'Acme Agent Ops',
          slug: 'acme-agent-ops',
          default_team_id: 'team_default',
          settings: {},
          status: 'active',
        },
      ],
    });

    render(await AuthPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('heading', { name: 'Continue workspace' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue to Acme Agent Ops' })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/overview',
    );
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/api/auth/google/start',
    );
  });

  it('renders only functional org onboarding fields', async () => {
    vi.mocked(getCurrentSession).mockResolvedValueOnce({
      user: { id: 'usr_owner', email: 'owner@example.test', name: 'Owner User' },
      orgs: [],
    });

    render(await OnboardingPage());

    expect(screen.getByRole('heading', { name: 'Set up your organization' })).toBeInTheDocument();
    expect(screen.getByLabelText('agentOps activation path')).toBeInTheDocument();
    expect(screen.getByLabelText('Organization name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Website or domain')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Primary use case')).not.toBeInTheDocument();
    expect(screen.queryByText(/Select a starting point/i)).not.toBeInTheDocument();
  });

  it('keeps agent registration behind one focused action', async () => {
    vi.mocked(getOrgBySlug).mockResolvedValueOnce({
      id: 'org_acme',
      name: 'Acme Agent Ops',
      slug: 'acme-agent-ops',
      default_team_id: 'team_default',
      settings: {},
      status: 'active',
    });
    vi.mocked(listAgentsPage).mockResolvedValueOnce({
      agents: [],
      pagination: { limit: 25, offset: 0, total: 0 },
    });
    vi.mocked(listTeams).mockResolvedValueOnce([]);

    render(await AgentsPage({ params: Promise.resolve({ orgSlug: 'acme-agent-ops' }) }));

    expect(screen.getByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add agent' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Agent name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Labels')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Environment')).not.toBeInTheDocument();
    expect(screen.queryByText(/Labels are free-form/i)).not.toBeInTheDocument();
  });

  it('renders the workspace overview from a slug-scoped organization', async () => {
    vi.mocked(getOrgBySlug).mockResolvedValueOnce({
      id: 'org_acme',
      name: 'Acme Agent Ops',
      slug: 'acme-agent-ops',
      default_team_id: 'team_default',
      settings: {},
      status: 'active',
    });
    vi.mocked(listAgents).mockResolvedValueOnce([]);
    vi.mocked(listApprovals).mockResolvedValueOnce({ approvals: [] });
    vi.mocked(listAuditEvents).mockResolvedValueOnce({ events: [] });

    render(await OverviewPage({ params: Promise.resolve({ orgSlug: 'acme-agent-ops' }) }));

    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Connect an agent' })).toBeInTheDocument();
    expect(screen.getAllByText('Acme Agent Ops').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Switch to dark theme/ })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '+ New agent' })[0]).toHaveAttribute('href', '/app/acme-agent-ops/agents');
  });

  it('shows only evidence-backed overview metrics and recent organization evidence', async () => {
    vi.mocked(getOrgBySlug).mockResolvedValueOnce({
      id: 'org_acme',
      name: 'Acme Agent Ops',
      slug: 'acme-agent-ops',
      default_team_id: 'team_default',
      settings: {},
      status: 'active',
    });
    vi.mocked(listAgents).mockResolvedValueOnce([
      {
        id: 'agt_research',
        name: 'Research agent',
        status: 'active',
        labels: ['research'],
        team: { id: 'team_default', name: 'Default' },
        connection_health: 'healthy',
        policy_coverage: 2,
        wallet_refs_count: 0,
        last_activity_at: '2026-07-12T10:00:00.000Z',
      },
    ]);
    vi.mocked(listApprovals).mockResolvedValueOnce({
      approvals: [{
        id: 'apv_pending', org_id: 'org_acme', agent_id: 'agt_research', connection_id: 'conn_1',
        decision_id: 'pdec_1', status: 'pending', action_id: 'payment.x402.authorize', target_type: 'agent',
        target_id: 'agt_research', context: {}, context_hash: 'hash', requested_by: 'conn_1', approved_by: null,
        approved_at: null, denied_by: null, denied_at: null, consumed_at: null,
        expires_at: '2026-07-12T12:00:00.000Z', note: '', created_at: '2026-07-12T10:00:00.000Z',
        updated_at: '2026-07-12T10:00:00.000Z',
      }],
    });
    vi.mocked(listAuditEvents).mockResolvedValueOnce({
      events: [{
        id: 'aud_1', orgId: 'org_acme', sequence: 1, idempotencyKey: null, eventType: 'agent.registered',
        occurredAt: '2026-07-12T09:00:00.000Z', recordedAt: '2026-07-12T09:00:00.000Z', actorType: 'user',
        actorId: 'usr_owner', action: 'agent.registered', outcome: 'success', reasonCode: null, resourceType: 'agent',
        resourceId: 'agt_research', eventDomain: 'identity', eventCategory: 'configuration', severity: 'info', tags: [],
        relatedAgentId: 'agt_research', relatedTeamId: null, relatedConnectionId: null, relatedWalletRefId: null,
        relatedPolicyId: null, relatedWalletId: null, requestId: null, sourceSection: 'section_1', sourceSystem: 'identity',
        sourceRef: null, policyRef: null, decisionRef: null, approvalRef: null, retentionClass: 'standard',
        redactionState: 'none', canonicalBodyHash: 'body_hash', previousHash: null, eventHash: 'event_hash',
      }],
    });

    render(await OverviewPage({ params: Promise.resolve({ orgSlug: 'acme-agent-ops' }) }));

    expect(screen.getByText('Active agents').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Pending approvals').nextElementSibling).toHaveTextContent('1');
    expect(screen.getAllByText('Research agent').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Agent registered')).toBeInTheDocument();
    expect(screen.queryByText(/connected now/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Agent roster' })).not.toBeInTheDocument();
  });

  it('shows fleet cards for registered agents on home', async () => {
    vi.mocked(getOrgBySlug).mockResolvedValueOnce({
      id: 'org_acme', name: 'Acme Agent Ops', slug: 'acme-agent-ops', default_team_id: 'team_default', settings: {}, status: 'active',
    });
    vi.mocked(listAgents).mockResolvedValueOnce([
      {
        id: 'agt_old', name: 'Older agent', status: 'active', labels: [], team: { id: 'team_default', name: 'Default' },
        connection_health: 'healthy', policy_coverage: 0, wallet_refs_count: 0, last_activity_at: null,
      },
      {
        id: 'agt_new', name: 'Newer agent', status: 'active', labels: [], team: { id: 'team_default', name: 'Default' },
        connection_health: 'healthy', policy_coverage: 0, wallet_refs_count: 0, last_activity_at: null,
      },
    ]);
    vi.mocked(listApprovals).mockResolvedValueOnce({ approvals: [] });
    vi.mocked(listAuditEvents).mockResolvedValueOnce({ events: [] });

    render(await OverviewPage({ params: Promise.resolve({ orgSlug: 'acme-agent-ops' }) }));

    expect(screen.getByRole('heading', { name: 'Agent fleet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Older agent/i })).toHaveAttribute('href', '/app/acme-agent-ops/agents/agt_old');
    expect(screen.getByRole('link', { name: /Newer agent/i })).toHaveAttribute('href', '/app/acme-agent-ops/agents/agt_new');
  });
});

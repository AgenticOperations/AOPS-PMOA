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
} from '@/lib/server/identity-spine-client.js';

vi.mock('@/lib/server/identity-spine-client.js', () => ({
  getCurrentSession: vi.fn(),
  getOrgBySlug: vi.fn(),
  listAgents: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

describe('Section 1 product flow', () => {
  it('keeps root public and sends users to auth instead of public org creation', async () => {
    render(await HomePage());

    expect(screen.getByRole('heading', { name: 'agentOps' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/auth');
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
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
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

  it('renders only required agent registration fields', async () => {
    vi.mocked(getOrgBySlug).mockResolvedValueOnce({
      id: 'org_acme',
      name: 'Acme Agent Ops',
      slug: 'acme-agent-ops',
      default_team_id: 'team_default',
      settings: {},
      status: 'active',
    });
    vi.mocked(listAgents).mockResolvedValueOnce([]);

    render(await AgentsPage({ params: Promise.resolve({ orgSlug: 'acme-agent-ops' }) }));

    expect(screen.getByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    expect(screen.getByLabelText('Agent name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Authorise a new agent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
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

    render(await OverviewPage({ params: Promise.resolve({ orgSlug: 'acme-agent-ops' }) }));

    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getAllByText('Acme Agent Ops').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open agents' })).toHaveAttribute(
      'href',
      '/app/acme-agent-ops/agents',
    );
    expect(screen.getByRole('link', { name: 'Add agent' })).toHaveAttribute('href', '/app/acme-agent-ops/agents');
  });
});

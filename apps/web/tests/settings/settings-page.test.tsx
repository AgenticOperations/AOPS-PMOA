import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsPage from '../../src/app/app/[orgSlug]/settings/page.js';
import {
  getOrgBySlug,
  listMembers,
  listOnboardingStates,
  listTeams,
} from '@/lib/server/identity-spine-client.js';

vi.mock('@/lib/server/identity-spine-client.js', () => ({
  addMember: vi.fn(),
  archiveTeam: vi.fn(),
  createTeam: vi.fn(),
  getOrgBySlug: vi.fn(),
  listMembers: vi.fn(),
  listOnboardingStates: vi.fn(),
  listTeams: vi.fn(),
  removeMember: vi.fn(),
  updateMember: vi.fn(),
  updateTeam: vi.fn(),
  upsertOnboardingState: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  usePathname: () => '/app/acme-agent-ops/settings',
  useRouter: () => ({ push: vi.fn() }),
}));

const org = {
  id: 'org_acme',
  name: 'Acme Agent Ops',
  slug: 'acme-agent-ops',
  default_team_id: 'team_default',
  settings: {},
  status: 'active' as const,
};

const members = [
  {
    id: 'mem_owner',
    org_id: org.id,
    user_id: 'usr_owner',
    email: 'owner@example.test',
    name: 'Owner User',
    avatar_url: null,
    role: 'owner' as const,
    status: 'active' as const,
    joined_at: '2026-07-10T00:00:00.000Z',
    created_at: '2026-07-10T00:00:00.000Z',
    updated_at: '2026-07-10T00:00:00.000Z',
  },
  {
    id: 'mem_removed',
    org_id: org.id,
    user_id: 'usr_removed',
    email: 'removed@example.test',
    name: 'Removed User',
    avatar_url: null,
    role: 'viewer' as const,
    status: 'removed' as const,
    joined_at: '2026-07-10T00:00:00.000Z',
    created_at: '2026-07-10T00:00:00.000Z',
    updated_at: '2026-07-10T00:00:00.000Z',
  },
];

const teams = [
  {
    id: 'team_default',
    org_id: org.id,
    name: 'Default',
    description: 'Default team',
    is_default: true,
    archived_at: null,
    created_at: '2026-07-10T00:00:00.000Z',
    updated_at: '2026-07-10T00:00:00.000Z',
  },
  {
    id: 'team_archived',
    org_id: org.id,
    name: 'Archived QA',
    description: 'Archived team',
    is_default: false,
    archived_at: '2026-07-11T00:00:00.000Z',
    created_at: '2026-07-10T00:00:00.000Z',
    updated_at: '2026-07-11T00:00:00.000Z',
  },
];

function mockSettingsData() {
  vi.mocked(getOrgBySlug).mockResolvedValueOnce(org);
  vi.mocked(listMembers).mockResolvedValueOnce(members);
  vi.mocked(listTeams).mockResolvedValueOnce(teams);
  vi.mocked(listOnboardingStates).mockResolvedValueOnce([
    {
      id: 'onb_wallet',
      org_id: org.id,
      flow_key: 'circle_wallet_sync',
      status: 'completed',
      payload: {},
      completed_at: '2026-07-10T00:00:00.000Z',
      created_by_user_id: 'usr_owner',
      created_at: '2026-07-10T00:00:00.000Z',
      updated_at: '2026-07-10T00:00:00.000Z',
    },
  ]);
}

describe('SettingsPage', () => {
  it('shows members as the default settings tab with member actions', async () => {
    mockSettingsData();

    render(
      await SettingsPage({
        params: Promise.resolve({ orgSlug: org.slug }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole('heading', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('owner@example.test')).toBeInTheDocument();
    expect(screen.queryByText('removed@example.test')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open member Owner User' }));
    expect(screen.getByRole('dialog', { name: 'Owner User' })).toBeInTheDocument();
    expect(screen.getByText('Sole owner')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(screen.getByRole('button', { name: 'Add member' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    expect(screen.getByRole('dialog', { name: 'Add member' })).toBeInTheDocument();
  });

  it('shows teams and create team action on the teams tab', async () => {
    mockSettingsData();

    render(
      await SettingsPage({
        params: Promise.resolve({ orgSlug: org.slug }),
        searchParams: Promise.resolve({ tab: 'teams' }),
      }),
    );

    expect(screen.getByRole('link', { name: 'Teams' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Default team')).toBeInTheDocument();
    const archivedRow = screen.getByText('Archived QA').closest('tr');
    expect(archivedRow).not.toBeNull();
    expect(within(archivedRow!).getByText('archived')).toBeInTheDocument();
    fireEvent.click(within(archivedRow!).getByRole('button', { name: 'Open team Archived QA' }));
    expect(screen.getByRole('dialog', { name: 'Archived QA' })).toBeInTheDocument();
    expect(within(archivedRow!).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(within(archivedRow!).queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));
    expect(screen.getByRole('dialog', { name: 'Create team' })).toBeInTheDocument();
  });

  it('keeps setup optional on the profile tab', async () => {
    mockSettingsData();

    render(
      await SettingsPage({
        params: Promise.resolve({ orgSlug: org.slug }),
        searchParams: Promise.resolve({ tab: 'profile' }),
      }),
    );

    expect(screen.getByRole('link', { name: 'Profile & setup' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByText('Acme Agent Ops').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Circle wallet sync')).toBeInTheDocument();
    expect(screen.getAllByText('completed').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Skip for now' }).length).toBeGreaterThan(0);
  });
});

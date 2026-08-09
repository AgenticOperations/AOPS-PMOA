import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JoinInviteTable } from '@/components/agents/JoinInviteTable';
import type { AgentJoinInviteRecord } from '@/lib/server/identity-spine-client';

vi.mock('@/lib/date-format', () => ({
  formatUtcDateTime: (value: string) => value,
}));

const sampleInvite: AgentJoinInviteRecord = {
  id: 'ajoin_1',
  org_id: 'org_1',
  label: 'Sandbox',
  max_uses: 1,
  use_count: 0,
  expires_at: null,
  revoked_at: null,
  created_at: '2026-08-09T12:00:00.000Z',
};

describe('JoinInviteTable', () => {
  it('shows empty state when there are no invites', () => {
    render(<JoinInviteTable invites={[]} revokeAction={async () => undefined} />);
    expect(screen.getByRole('heading', { name: /no join invites yet/i })).toBeInTheDocument();
  });

  it('lists active invites with revoke', () => {
    render(<JoinInviteTable invites={[sampleInvite]} revokeAction={async () => undefined} />);
    expect(screen.getByText('Sandbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revoke/i })).toBeInTheDocument();
  });
});

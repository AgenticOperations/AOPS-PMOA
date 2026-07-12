import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ApprovalsPage from '../../src/app/app/[orgSlug]/approvals/page.js';
import { listApprovals } from '@/lib/server/approval-client.js';
import { listAuditEvents } from '@/lib/server/audit-client.js';
import { getOrgBySlug } from '@/lib/server/identity-spine-client.js';

vi.mock('@/lib/server/approval-client.js', () => ({
  approveApproval: vi.fn(),
  denyApproval: vi.fn(),
  listApprovals: vi.fn(),
}));

vi.mock('@/lib/server/audit-client.js', () => ({
  listAuditEvents: vi.fn(),
}));

vi.mock('@/lib/server/identity-spine-client.js', () => ({
  getOrgBySlug: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  usePathname: () => '/app/acme-agent-ops/approvals',
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

const approvals = [
  {
    id: 'apr_pending',
    org_id: org.id,
    agent_id: 'agt_trade',
    connection_id: 'conn_trade',
    decision_id: 'dec_pending',
    status: 'pending' as const,
    action_id: 'payment.x402.authorize',
    target_type: 'agent',
    target_id: 'agt_trade',
    context: { payment: { amount: '2.00', asset: 'USDC' }, resource: { category: 'market-data' } },
    context_hash: 'hash_pending',
    requested_by: 'conn_trade',
    approved_by: null,
    approved_at: null,
    denied_by: null,
    denied_at: null,
    consumed_at: null,
    expires_at: '2099-07-11T00:00:00.000Z',
    note: '',
    created_at: '2026-07-10T00:00:00.000Z',
    updated_at: '2026-07-10T00:00:00.000Z',
    actions: [],
    consumption: null,
  },
  {
    id: 'apr_consumed',
    org_id: org.id,
    agent_id: 'agt_trade',
    connection_id: 'conn_trade',
    decision_id: 'dec_consumed',
    status: 'consumed' as const,
    action_id: 'payment.x402.authorize',
    target_type: 'agent',
    target_id: 'agt_trade',
    context: { payment: { amount: '0.50', asset: 'USDC' }, resource: { category: 'market-data' } },
    context_hash: 'hash_consumed',
    requested_by: 'conn_trade',
    approved_by: 'usr_owner',
    approved_at: '2026-07-10T00:05:00.000Z',
    denied_by: null,
    denied_at: null,
    consumed_at: '2026-07-10T00:06:00.000Z',
    expires_at: '2026-07-11T00:00:00.000Z',
    note: 'approved',
    created_at: '2026-07-10T00:00:00.000Z',
    updated_at: '2026-07-10T00:06:00.000Z',
    actions: [],
    consumption: {
      id: 'apc_1',
      decision_id: 'dec_consumed',
      connection_id: 'conn_trade',
      context_hash: 'hash_consumed',
      created_at: '2026-07-10T00:06:00.000Z',
    },
  },
];

function mockApprovalData() {
  vi.mocked(getOrgBySlug).mockResolvedValueOnce(org);
  vi.mocked(listApprovals).mockResolvedValueOnce({ approvals });
  vi.mocked(listAuditEvents).mockResolvedValueOnce({ events: [] });
}

describe('ApprovalsPage', () => {
  it('shows pending approval requests in the inbox tab', async () => {
    mockApprovalData();

    render(
      await ApprovalsPage({
        params: Promise.resolve({ orgSlug: org.slug }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole('heading', { name: 'Approvals' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inbox' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Pending requests' })).toBeInTheDocument();
    expect(screen.getByText('apr_pending')).toBeInTheDocument();
    expect(screen.queryByText('apr_consumed')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review apr_pending' }));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
  });

  it('moves closed approvals into the history tab', async () => {
    mockApprovalData();

    render(
      await ApprovalsPage({
        params: Promise.resolve({ orgSlug: org.slug }),
        searchParams: Promise.resolve({ tab: 'history' }),
      }),
    );

    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: 'Approval history' })).toBeInTheDocument();
    expect(screen.getByText('apr_consumed')).toBeInTheDocument();
    expect(screen.queryByText('apr_pending')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review apr_consumed' }));
    expect(screen.getByText('apc_1')).toBeInTheDocument();
  });
});

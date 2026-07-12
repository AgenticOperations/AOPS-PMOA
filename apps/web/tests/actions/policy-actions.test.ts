import { beforeEach, describe, expect, it, vi } from 'vitest';
import { simulatePolicyDraftAction, updatePolicyDraftAction } from '@/app/actions/policy';
import { simulatePolicyDraft } from '@/lib/server/policy-client';
import { revalidatePath } from 'next/cache';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/server/policy-client', () => ({
  activatePolicyDraft: vi.fn(),
  activatePolicyRevisionDraft: vi.fn(),
  archivePolicy: vi.fn(),
  bindPolicy: vi.fn(),
  createPolicyDraft: vi.fn(),
  createPolicyRestoreDraft: vi.fn(),
  createPolicyRevisionDraft: vi.fn(),
  discardPolicyDraft: vi.fn(),
  removePolicyBinding: vi.fn(),
  simulatePolicyDraft: vi.fn(),
  updatePolicyDraft: vi.fn(),
  validatePolicyDraft: vi.fn(),
}));

describe('policy actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps a complete x402 dry-run form into the existing policy decision contract', async () => {
    const formData = new FormData();
    formData.set('draftId', 'pdraft_market_data');
    formData.set('targetKey', 'agent:agt_research');
    formData.set('action', 'payment.x402.authorize');
    formData.set('actorRole', 'admin');
    formData.set('resourceUrl', 'https://api.example.com/data');
    formData.set('resourceCategory', 'market-data');
    formData.set('paymentAmount', '2.00');
    formData.set('paymentAsset', 'USDC');
    formData.set('paymentNetwork', 'eip155:421614');
    formData.set('paymentRecipient', '0x1111111111111111111111111111111111111111');

    await simulatePolicyDraftAction('org_acme', 'acme-agent-ops', formData);

    expect(simulatePolicyDraft).toHaveBeenCalledWith('org_acme', 'pdraft_market_data', {
      actor: { type: 'user', role: 'admin' },
      action: 'payment.x402.authorize',
      target: { type: 'agent', id: 'agt_research' },
      context: {
        resource: {
          url: 'https://api.example.com/data',
          category: 'market-data',
          domain: 'api.example.com',
        },
        payment: {
          amount: '2.00',
          asset: 'USDC',
          network: 'eip155:421614',
          recipient: '0x1111111111111111111111111111111111111111',
        },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith('/app/acme-agent-ops/controls');
  });

  it('includes tool risk context when simulating a tool policy', async () => {
    const formData = new FormData();
    formData.set('draftId', 'pdraft_tool');
    formData.set('targetKey', 'agent:agt_research');
    formData.set('action', 'tool.call');
    formData.set('toolName', 'browser.search');
    formData.set('toolRiskLevel', 'high');

    await simulatePolicyDraftAction('org_acme', 'acme-agent-ops', formData);

    expect(simulatePolicyDraft).toHaveBeenCalledWith(
      'org_acme',
      'pdraft_tool',
      expect.objectContaining({
        context: { tool: { name: 'browser.search', riskLevel: 'high' } },
      }),
    );
  });

  it('maps every editable statement field when saving a revision draft', async () => {
    const formData = new FormData();
    formData.set('draftId', 'pdraft_revision');
    formData.set('statementId', 'stmt_existing');
    formData.set('name', 'Revised market data approval');
    formData.set('description', 'Require approval for paid market data.');
    formData.set('category', 'operational');
    formData.set('action', 'payment.x402.authorize');
    formData.set('decision', 'approval_required');
    formData.set('actorRole', 'owner');
    formData.set('resourceCategory', 'market-data, research');
    formData.set('resourceDomain', 'api.example.com');
    formData.set('paymentMinAmount', '1.00');
    formData.set('paymentMaxAmount', '25.00');
    formData.set('paymentAsset', 'USDC');
    formData.set('paymentNetwork', 'eip155:84532, eip155:421614');
    formData.set('paymentRecipient', '0x1111111111111111111111111111111111111111');

    await updatePolicyDraftAction('org_acme', 'acme-agent-ops', formData);

    const { updatePolicyDraft } = await import('@/lib/server/policy-client');
    expect(updatePolicyDraft).toHaveBeenCalledWith('org_acme', 'pdraft_revision', {
      statementId: 'stmt_existing',
      name: 'Revised market data approval',
      description: 'Require approval for paid market data.',
      category: 'operational',
      action: 'payment.x402.authorize',
      decision: 'approval_required',
      actorRole: 'owner',
      resourceCategory: 'market-data, research',
      resourceDomain: 'api.example.com',
      paymentMinAmount: '1.00',
      paymentMaxAmount: '25.00',
      paymentAsset: 'USDC',
      paymentNetwork: 'eip155:84532, eip155:421614',
      paymentRecipient: '0x1111111111111111111111111111111111111111',
      toolName: undefined,
      toolRiskLevel: undefined,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/app/acme-agent-ops/controls');
  });
});

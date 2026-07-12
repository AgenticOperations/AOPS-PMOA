import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ControlsLibrary } from '../../src/components/controls/ControlsLibrary.js';

describe('ControlsLibrary', () => {
  it('renders the Section 2 policy core without future finance or marketplace placeholders', () => {
    render(
      <ControlsLibrary
        drafts={[
          {
            id: 'pdraft_credentials',
            name: 'Draft credential control',
            status: 'validated',
            source: 'blank',
            category: 'management',
            description: 'Blocks credential issuance for selected agents.',
            updated_at: '2026-07-07T10:00:00.000Z',
          },
        ]}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        bindTargets={[{ id: 'agt_research', label: 'Research Agent', type: 'agent' }]}
        policies={[
          {
            id: 'pol_credentials',
            version: 1,
            name: 'Credential controls',
            status: 'active',
            category: 'management',
            description: 'Credential issue is denied for governed agents.',
            bindings_count: 1,
            binding_target_types: ['org', 'team', 'agent'],
            bindings: [
              {
                id: 'pbind_research',
                target_id: 'agt_research',
                target_type: 'agent',
                status: 'active',
                created_at: '2026-07-07T10:00:00.000Z',
              },
            ],
            created_at: '2026-07-07T10:00:00.000Z',
          },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Controls' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New policy' }));
    expect(screen.getByText('Policy details')).toBeInTheDocument();
    expect(screen.getByText('Action and result')).toBeInTheDocument();
    expect(screen.getByText('Match conditions')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Draft setup')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'External HTTP/API request' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Authorize x402 payment check' })).toBeInTheDocument();
    expect(screen.getByLabelText('Resource category')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tool name')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Credential controls' }));
    expect(screen.getByRole('heading', { name: 'Credential controls' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Assignment scopes')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Bind target' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: /Drafts/ }));
    expect(screen.getByText('Draft credential control')).toBeInTheDocument();
    expect(screen.queryByText(/treasury/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/marketplace/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/wallet balance/i)).not.toBeInTheDocument();
  });

  it('toggles draft policies inside the policy table instead of opening a draft drawer', () => {
    render(
      <ControlsLibrary
        drafts={[
          {
            id: 'pdraft_weather',
            name: 'Draft weather block',
            status: 'draft',
            source: 'structured',
            category: 'operational',
            description: 'Deny weather requests for selected agents.',
            updated_at: '2026-07-07T10:00:00.000Z',
          },
        ]}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        policies={[]}
        validateAction={async () => {}}
      />,
    );

    expect(screen.queryByText('Draft weather block')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
    expect(screen.getByText('Draft weather block')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validate Draft weather block' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Drafts' })).not.toBeInTheDocument();
  });

  it('keeps policy detail focused on policy facts instead of assignment management', () => {
    render(
      <ControlsLibrary
        drafts={[]}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        bindTargets={[
          { id: 'org_acme', label: 'Acme Workspace', type: 'org' },
          { id: 'agt_research', label: 'Research Agent', type: 'agent' },
          { id: 'conn_local', label: 'Local credential (Research Agent)', type: 'connection' },
        ]}
        policies={[
          {
            id: 'pol_weather',
            version: 1,
            name: 'Deny weather API',
            status: 'active',
            category: 'operational',
            description: 'Blocks weather requests.',
            bindings_count: 1,
            binding_target_types: ['org', 'team', 'agent'],
            bindings: [
              {
                id: 'pbind_weather',
                target_id: 'agt_research',
                target_type: 'agent',
                status: 'active',
                created_at: '2026-07-07T10:00:00.000Z',
              },
            ],
            created_at: '2026-07-07T10:00:00.000Z',
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Deny weather API' }));
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Conditions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Evidence' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lifecycle' })).toBeInTheDocument();
    expect(screen.getByText('Assignment scopes')).toBeInTheDocument();
    expect(screen.queryByText('Bound targets')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Bind target' })).not.toBeInTheDocument();
  });

  it('does not expose payment or tool fields while drafting an HTTP/API request policy', () => {
    render(
      <ControlsLibrary
        drafts={[]}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        policies={[]}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'New policy' })[0]!);
    expect(screen.getByRole('combobox', { name: 'Action' })).toHaveValue('runtime.http.request');
    expect(screen.getByLabelText('Resource category')).toBeInTheDocument();
    expect(screen.getByLabelText('Resource domain')).toBeInTheDocument();
    expect(screen.queryByLabelText('Payment minimum')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Payment asset')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tool name')).not.toBeInTheDocument();
  });

  it('shows only resource and payment fields while drafting an x402 authorization policy', () => {
    render(
      <ControlsLibrary
        drafts={[]}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        policies={[]}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'New policy' })[0]!);
    fireEvent.change(screen.getByRole('combobox', { name: 'Action' }), {
      target: { value: 'payment.x402.authorize' },
    });

    expect(screen.getByLabelText('Resource category')).toBeInTheDocument();
    expect(screen.getByLabelText('Resource domain')).toBeInTheDocument();
    expect(screen.getByLabelText('Payment minimum')).toBeInTheDocument();
    expect(screen.getByLabelText('Payment asset')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tool name')).not.toBeInTheDocument();
  });

  it('opens revision drafts in the action-specific editor without dropping enforcement fields', () => {
    render(
      <ControlsLibrary
        drafts={[
          {
            id: 'pdraft_market_revision',
            name: 'Market data approval v2',
            status: 'draft',
            source: 'structured',
            category: 'operational',
            description: 'Revise paid market data controls.',
            revision_policy_id: 'pol_market',
            revision_base_version: 1,
            revision_mode: 'revision',
            updated_at: '2026-07-11T10:00:00.000Z',
            statements: [
              {
                id: 'stmt_market',
                actions: ['payment.x402.authorize'],
                decision: 'approval_required',
                actor: { roles: ['owner'] },
                target: { types: ['agent', 'org', 'team'] },
                conditions: {
                  resource: { categories: ['market-data', 'research'], domains: ['api.example.com'] },
                  payment: {
                    minAmount: '1.00',
                    maxAmount: '25.00',
                    assets: ['USDC'],
                    networks: ['eip155:84532', 'eip155:421614'],
                    recipients: ['0x1111111111111111111111111111111111111111'],
                  },
                },
              },
            ],
          },
        ]}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        policies={[]}
        updateDraftAction={async () => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
    fireEvent.click(screen.getByLabelText('Open draft Market data approval v2'));

    const editor = within(screen.getByRole('region', { name: 'Market data approval v2 edit' }));
    expect(editor.getByRole('combobox', { name: 'Action' })).toHaveValue('payment.x402.authorize');
    expect(editor.getByRole('combobox', { name: 'Decision' })).toHaveValue('approval_required');
    expect(editor.getByRole('combobox', { name: 'Operator role' })).toHaveValue('owner');
    expect(editor.getByLabelText('Resource category')).toHaveValue('market-data, research');
    expect(editor.getByLabelText('Resource domain')).toHaveValue('api.example.com');
    expect(editor.getByLabelText('Payment minimum')).toHaveValue('1.00');
    expect(editor.getByLabelText('Payment maximum')).toHaveValue('25.00');
    expect(editor.getByLabelText('Payment asset')).toHaveValue('USDC');
    expect(editor.getByLabelText('Payment network')).toHaveValue('eip155:84532, eip155:421614');
    expect(editor.getByLabelText('Payment recipient')).toHaveValue('0x1111111111111111111111111111111111111111');
    expect(editor.getByRole('button', { name: 'Save draft changes' })).toBeInTheDocument();
  });

  it('closes an open drawer when the server reports that its draft was discarded', () => {
    const draft = {
      id: 'pdraft_discard',
      name: 'Discarded lifecycle draft',
      status: 'draft' as const,
      source: 'structured' as const,
      category: 'operational' as const,
      description: 'Temporary rule.',
      updated_at: '2026-07-11T10:00:00.000Z',
      statements: [{ id: 'stmt_discard', actions: ['runtime.http.request'], decision: 'deny' }],
    };
    const props = {
      orgId: 'org_acme',
      orgSlug: 'acme-agent-ops',
      policies: [],
      updateDraftAction: async () => {},
      simulateDraftAction: async () => {},
    };
    const view = render(<ControlsLibrary {...props} drafts={[draft]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
    fireEvent.click(screen.getByLabelText('Open draft Discarded lifecycle draft'));
    expect(screen.getByRole('button', { name: 'Save draft changes' })).toBeInTheDocument();

    view.rerender(
      <ControlsLibrary
        {...props}
        drafts={[{ ...draft, status: 'discarded' as const, updated_at: '2026-07-11T10:01:00.000Z' }]}
      />,
    );

    expect(screen.queryByRole('dialog', { name: 'Discarded lifecycle draft' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run dry run' })).not.toBeInTheDocument();
  });

  it('does not expose global bindings as a top-level Controls section', () => {
    render(
      <ControlsLibrary
        drafts={[]}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        bindTargets={[{ id: 'agt_research', label: 'Research Agent', type: 'agent' }]}
        policyActions={[
          {
            action_id: 'runtime.http.request',
            binding_target_types: ['org', 'team', 'agent'],
            category: 'runtime',
            condition_groups: ['resource'],
            description: 'Control external API access.',
            enforceability: 'enforceable',
            introduced_section: 2,
            label: 'External HTTP/API request',
          },
        ]}
        policies={[
          {
            id: 'pol_weather',
            version: 1,
            name: 'Deny weather API',
            status: 'active',
            category: 'operational',
            description: 'Blocks weather requests.',
            bindings_count: 1,
            binding_target_types: ['org', 'team', 'agent'],
            statements: [
              {
                id: 'stmt_weather',
                actions: ['runtime.http.request'],
                decision: 'deny',
              },
            ],
            bindings: [
              {
                id: 'pbind_weather',
                target_id: 'agt_research',
                target_type: 'agent',
                status: 'active',
                created_at: '2026-07-07T10:00:00.000Z',
              },
            ],
            created_at: '2026-07-07T10:00:00.000Z',
          },
        ]}
      />,
    );

    expect(screen.queryByRole('button', { name: /Bindings/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Policy bindings' })).not.toBeInTheDocument();
  });

  it('shows policy control activity without exposing runtime decision history on Controls', () => {
    render(
      <ControlsLibrary
        drafts={[]}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        activityEvents={[
          {
            id: 'aud_policy_created',
            orgId: 'org_acme',
            sequence: 8,
            idempotencyKey: null,
            eventType: 'policy.created',
            occurredAt: '2026-07-07T10:00:00.000Z',
            recordedAt: '2026-07-07T10:00:00.000Z',
            actorType: 'user',
            actorId: 'usr_admin',
            action: 'policy.created',
            outcome: 'success',
            reasonCode: 'policy_created',
            resourceType: 'policy',
            resourceId: 'pol_weather',
            eventDomain: 'policy',
            eventCategory: 'policy',
            severity: 'info',
            tags: ['controls'],
            relatedAgentId: null,
            relatedTeamId: null,
            relatedConnectionId: null,
            relatedWalletRefId: null,
            relatedPolicyId: 'pol_weather',
            relatedWalletId: null,
            requestId: null,
            sourceSection: 'controls',
            sourceSystem: 'web',
            sourceRef: null,
            policyRef: 'pol_weather:v1',
            decisionRef: null,
            approvalRef: null,
            retentionClass: 'standard',
            redactionState: 'none',
            canonicalBodyHash: 'hash_body',
            previousHash: null,
            eventHash: 'hash_policy_created_123456789',
          },
          {
            id: 'aud_policy_decision',
            orgId: 'org_acme',
            sequence: 9,
            idempotencyKey: null,
            eventType: 'policy.decision.recorded',
            occurredAt: '2026-07-07T10:01:00.000Z',
            recordedAt: '2026-07-07T10:01:00.000Z',
            actorType: 'agent',
            actorId: 'agt_research',
            action: 'policy.decision.recorded',
            outcome: 'denied',
            reasonCode: 'policy_denied',
            resourceType: 'policy_decision',
            resourceId: 'pdec_weather',
            eventDomain: 'policy',
            eventCategory: 'runtime',
            severity: 'info',
            tags: ['runtime'],
            relatedAgentId: 'agt_research',
            relatedTeamId: null,
            relatedConnectionId: null,
            relatedWalletRefId: null,
            relatedPolicyId: 'pol_weather',
            relatedWalletId: null,
            requestId: null,
            sourceSection: 'runtime',
            sourceSystem: 'api',
            sourceRef: null,
            policyRef: 'pol_weather:v1',
            decisionRef: 'pdec_weather',
            approvalRef: null,
            retentionClass: 'standard',
            redactionState: 'none',
            canonicalBodyHash: 'hash_body_decision',
            previousHash: 'hash_policy_created_123456789',
            eventHash: 'hash_policy_decision_123456789',
          },
        ]}
        policies={[
          {
            id: 'pol_weather',
            version: 1,
            name: 'Deny weather API',
            status: 'active',
            category: 'operational',
            description: 'Blocks weather requests.',
            bindings_count: 0,
            binding_target_types: ['org', 'team', 'agent'],
            bindings: [],
            created_at: '2026-07-07T10:00:00.000Z',
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Change log/ }));
    expect(screen.getByRole('table', { name: 'Policy change log' })).toBeInTheDocument();
    expect(screen.getByText('Policy Created')).toBeInTheDocument();
    expect(screen.getByText('policy_created')).toBeInTheDocument();
    expect(screen.queryByText('Policy Decision Recorded')).not.toBeInTheDocument();
    expect(screen.queryByText('policy_denied')).not.toBeInTheDocument();
    expect(screen.queryByText('Recorded decisions')).not.toBeInTheDocument();
    expect(screen.queryByText('Decision history')).not.toBeInTheDocument();
    expect(screen.queryByText('A policy denied this request.')).not.toBeInTheDocument();
  });

  it('shows archived policies as restore-only lifecycle items', () => {
    render(
      <ControlsLibrary
        createRestoreDraftAction={async () => {}}
        drafts={[]}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        policies={[
          {
            id: 'pol_archived',
            version: 2,
            name: 'Archived credential policy',
            status: 'archived',
            category: 'management',
            description: 'No longer enforcing.',
            bindings_count: 0,
            binding_target_types: ['agent'],
            bindings: [
              {
                id: 'pbind_old',
                target_id: 'agt_research',
                target_type: 'agent',
                status: 'removed',
                created_at: '2026-07-07T10:00:00.000Z',
                removed_reason: 'policy_archived',
              },
            ],
            created_at: '2026-07-07T10:00:00.000Z',
            archived_at: '2026-07-08T10:00:00.000Z',
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Archived credential policy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lifecycle' }));
    expect(screen.getByRole('button', { name: 'Create restore draft' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.queryByText('Confirm archive')).not.toBeInTheDocument();
  });

  it('hides irrelevant condition groups in policy detail', () => {
    render(
      <ControlsLibrary
        drafts={[]}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        policyActions={[
          {
            action_id: 'management.connection.issue',
            binding_target_types: ['org', 'team', 'agent'],
            category: 'management',
            condition_groups: [],
            description: 'Control credential issue.',
            enforceability: 'enforceable',
            introduced_section: 2,
            label: 'Issue credential',
          },
        ]}
        policies={[
          {
            id: 'pol_credentials',
            version: 1,
            name: 'Credential issue control',
            status: 'active',
            category: 'management',
            description: 'Blocks credential issue.',
            bindings_count: 0,
            binding_target_types: ['org', 'team', 'agent'],
            statements: [
              {
                id: 'stmt_issue',
                actions: ['management.connection.issue'],
                decision: 'deny',
              },
            ],
            bindings: [],
            created_at: '2026-07-07T10:00:00.000Z',
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open Credential issue control' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conditions' }));
    expect(screen.getByText('Additional conditions')).toBeInTheDocument();
    expect(screen.queryByText('Resource category')).not.toBeInTheDocument();
    expect(screen.queryByText('Payment minimum')).not.toBeInTheDocument();
    expect(screen.queryByText('Tool name')).not.toBeInTheDocument();
  });

  it('closes the Controls drawer on Escape through the shared Sheet primitive', () => {
    render(
      <ControlsLibrary
        drafts={[]}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        policies={[]}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'New policy' })[0]!);
    expect(screen.getByRole('dialog', { name: 'Create policy' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Create policy' })).not.toBeInTheDocument();
  });

  it('opens a draft with its real statement and a request-complete x402 simulation form', () => {
    render(
      <ControlsLibrary
        bindTargets={[{ id: 'agt_research', label: 'Research Agent', type: 'agent' }]}
        drafts={[
          {
            id: 'pdraft_market_data',
            name: 'Approve paid market data',
            status: 'draft',
            source: 'structured',
            category: 'operational',
            description: 'Require approval for paid market data.',
            statements: [
              {
                id: 'stmt_market_data',
                actions: ['payment.x402.authorize'],
                decision: 'approval_required',
                actor: { roles: ['member'] },
                target: { types: ['agent'] },
                conditions: {
                  resource: { categories: ['market-data'] },
                  payment: { minAmount: '1.00', assets: ['USDC'] },
                },
              },
            ],
            updated_at: '2026-07-07T10:00:00.000Z',
          },
        ]}
        orgId="org_acme"
        orgSlug="acme-agent-ops"
        policyActions={[
          {
            action_id: 'runtime.http.request',
            binding_target_types: ['org', 'team', 'agent'],
            category: 'runtime',
            condition_groups: ['resource'],
            description: 'Control external API access.',
            enforceability: 'enforceable',
            introduced_section: 2,
            label: 'External HTTP/API request',
          },
          {
            action_id: 'payment.x402.authorize',
            binding_target_types: ['org', 'team', 'agent'],
            category: 'payments',
            condition_groups: ['resource', 'payment'],
            description: 'Control x402 payment execution.',
            enforceability: 'enforceable',
            introduced_section: 6,
            label: 'Authorize x402 payment check',
          },
        ]}
        policies={[]}
        simulateDraftAction={async () => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
    fireEvent.click(screen.getByRole('cell', { name: 'Open draft Approve paid market data' }));

    expect(screen.getAllByText('Authorize x402 payment check').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Require approval').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('market-data').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('1.00 USDC')).toBeInTheDocument();
    const dryRunRegion = screen.getByRole('region', { name: 'Approve paid market data dry run' });
    const dryRun = within(dryRunRegion);
    expect(dryRun.getByLabelText('Action')).toHaveValue('Authorize x402 payment check');
    expect(dryRun.queryByRole('combobox', { name: 'Action' })).not.toBeInTheDocument();
    expect(dryRunRegion.querySelector('input[name="action"]')).toHaveValue('payment.x402.authorize');
    expect(dryRun.getByLabelText('Actor role')).toBeInTheDocument();
    expect(dryRun.getByLabelText('Resource URL')).toBeInTheDocument();
    expect(dryRun.getByLabelText('Resource category')).toBeInTheDocument();
    expect(dryRun.getByLabelText('Resource domain')).toBeInTheDocument();
    expect(dryRun.getByLabelText('Payment amount')).toBeInTheDocument();
    expect(dryRun.getByLabelText('Payment asset')).toBeInTheDocument();
    expect(dryRun.getByLabelText('Payment network')).toBeInTheDocument();
    expect(dryRun.getByLabelText('Payment recipient')).toBeInTheDocument();
    expect(dryRun.queryByLabelText('Tool name')).not.toBeInTheDocument();
    expect(dryRun.queryByLabelText('Tool risk level')).not.toBeInTheDocument();
  });
});

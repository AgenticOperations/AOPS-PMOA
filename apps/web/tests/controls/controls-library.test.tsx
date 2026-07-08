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
    expect(screen.getByText('Identity')).toBeInTheDocument();
    expect(screen.getByText('Rule')).toBeInTheDocument();
    expect(screen.getByText('Conditions')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Draft preview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'External HTTP/API request' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Authorize x402 payment check' })).toBeInTheDocument();
    expect(screen.getByLabelText('Resource category')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tool name')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Credential controls' }));
    expect(screen.getByRole('heading', { name: 'Credential controls' })).toBeInTheDocument();
    expect(screen.getByText('1 binding')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Research Agent · Agent' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
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

  it('shows existing binding targets separately from the new bind selector', () => {
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
    expect(screen.getByText('Bound targets')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Current bindings')).getByText('Research Agent · Agent')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Bind target' })).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Select target' })).toBeInTheDocument();
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
});

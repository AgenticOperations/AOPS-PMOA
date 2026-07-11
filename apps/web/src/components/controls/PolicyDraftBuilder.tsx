'use client';

import { useMemo, useState } from 'react';
import type { PolicyActionRecord } from '@/lib/policy-types';

type PolicyDraftBuilderProps = {
  readonly actions?: readonly PolicyActionRecord[] | undefined;
  readonly createAction?: ((formData: FormData) => Promise<void>) | undefined;
};

const fallbackPolicyActions: readonly PolicyActionRecord[] = [
  {
    action_id: 'runtime.http.request',
    binding_target_types: ['agent', 'org', 'team'],
    category: 'runtime',
    condition_groups: ['resource'],
    enforceability: 'enforceable',
    introduced_section: 2,
    label: 'External HTTP/API request',
    description: 'Deny, observe, or require approval before an agent accesses an external API or website.',
  },
  {
    action_id: 'payment.x402.authorize',
    binding_target_types: ['agent', 'org', 'team'],
    category: 'payment',
    condition_groups: ['resource', 'payment'],
    enforceability: 'enforceable',
    introduced_section: 2,
    label: 'Authorize x402 payment check',
    description: 'Control x402 payment authorization checks before payment-capable sections are attached.',
  },
  {
    action_id: 'tool.call',
    binding_target_types: ['agent', 'org', 'team'],
    category: 'tool',
    condition_groups: ['tool'],
    enforceability: 'enforceable',
    introduced_section: 2,
    label: 'Tool call',
    description: 'Control tool calls that pass through an agentOps-managed MCP or tool gateway.',
  },
  {
    action_id: 'management.connection.issue',
    binding_target_types: ['agent', 'org', 'team'],
    category: 'management',
    condition_groups: [],
    enforceability: 'enforceable',
    introduced_section: 2,
    label: 'Issue credential',
    description: 'Control whether operators can issue runtime credentials.',
  },
  {
    action_id: 'management.connection.rotate',
    binding_target_types: ['connection'],
    category: 'management',
    condition_groups: [],
    enforceability: 'enforceable',
    introduced_section: 2,
    label: 'Rotate credential',
    description: 'Control whether operators can rotate runtime credentials.',
  },
  {
    action_id: 'management.connection.revoke',
    binding_target_types: ['connection'],
    category: 'management',
    condition_groups: [],
    enforceability: 'enforceable',
    introduced_section: 2,
    label: 'Revoke credential',
    description: 'Control whether operators can revoke runtime credentials.',
  },
  {
    action_id: 'management.agent.pause',
    binding_target_types: ['agent', 'org', 'team'],
    category: 'management',
    condition_groups: [],
    enforceability: 'enforceable',
    introduced_section: 2,
    label: 'Pause agent',
    description: 'Control whether operators can pause agents.',
  },
  {
    action_id: 'management.agent.activate',
    binding_target_types: ['agent', 'org', 'team'],
    category: 'management',
    condition_groups: [],
    enforceability: 'enforceable',
    introduced_section: 2,
    label: 'Activate agent',
    description: 'Control whether operators can activate paused agents.',
  },
  {
    action_id: 'management.agent.deactivate',
    binding_target_types: ['agent', 'org', 'team'],
    category: 'management',
    condition_groups: [],
    enforceability: 'enforceable',
    introduced_section: 2,
    label: 'Deactivate agent',
    description: 'Control whether operators can deactivate agents.',
  },
] as const;

const defaultPolicyAction = fallbackPolicyActions[0] as PolicyActionRecord;

function fieldEnabled(action: PolicyActionRecord, section: 'payment' | 'resource' | 'tool'): boolean {
  return action.condition_groups.includes(section);
}

function formatDecision(decision: string): string {
  if (decision === 'approval_required') return 'Require approval';
  if (decision === 'observe') return 'Observe';
  return 'Deny';
}

export function PolicyDraftBuilder({ actions = fallbackPolicyActions, createAction }: PolicyDraftBuilderProps) {
  const availableActions = actions.length > 0 ? actions : fallbackPolicyActions;
  const [selectedAction, setSelectedAction] = useState<string>(availableActions[0]?.action_id ?? defaultPolicyAction.action_id);
  const [decision, setDecision] = useState('deny');
  const [policyName, setPolicyName] = useState('');
  const [description, setDescription] = useState('');
  const [actorRole, setActorRole] = useState('');
  const [resourceCategory, setResourceCategory] = useState('');
  const [resourceDomain, setResourceDomain] = useState('');
  const [paymentMinAmount, setPaymentMinAmount] = useState('');
  const [paymentAsset, setPaymentAsset] = useState('');
  const [toolName, setToolName] = useState('');
  const action = useMemo<PolicyActionRecord>(
    () => availableActions.find((candidate) => candidate.action_id === selectedAction) ?? availableActions[0] ?? defaultPolicyAction,
    [availableActions, selectedAction],
  );
  const conditionSummary = useMemo(() => {
    const conditions: string[] = [];
    if (resourceCategory.trim().length > 0) conditions.push(`category ${resourceCategory.trim()}`);
    if (resourceDomain.trim().length > 0) conditions.push(`domain ${resourceDomain.trim()}`);
    if (paymentMinAmount.trim().length > 0) conditions.push(`minimum ${paymentMinAmount.trim()}`);
    if (paymentAsset.trim().length > 0) conditions.push(`asset ${paymentAsset.trim()}`);
    if (toolName.trim().length > 0) conditions.push(`tool ${toolName.trim()}`);
    if (actorRole.length > 0) conditions.push(`role ${actorRole}`);
    return conditions.length > 0 ? conditions.join(' · ') : 'No optional conditions set';
  }, [actorRole, paymentAsset, paymentMinAmount, resourceCategory, resourceDomain, toolName]);
  const previewName = policyName.trim().length > 0 ? policyName.trim() : 'Untitled policy draft';
  const previewDescription =
    description.trim().length > 0
      ? description.trim()
      : `${formatDecision(decision)} for ${action.label.toLowerCase()}.`;

  return (
    <form action={createAction} className="policy-builder-form">
      <div className="policy-builder-layout">
        <div className="policy-builder-main">
          <section className="policy-builder-section">
            <div className="policy-builder-section-index">01</div>
            <div className="policy-builder-section-body">
              <div className="policy-builder-section-heading">
                <h3>Identity</h3>
                <p>Name the reusable policy object operators will bind later.</p>
              </div>
              <div className="policy-builder-field-grid">
                <label className="policy-builder-field">
                  <span>Policy name</span>
                  <input
                    name="name"
                    onChange={(event) => setPolicyName(event.target.value)}
                    placeholder="Block weather API access"
                    required
                    value={policyName}
                  />
                </label>
                <label className="policy-builder-field">
                  <span>Description</span>
                  <input
                    name="description"
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Deny weather API requests for attached agents"
                    value={description}
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="policy-builder-section">
            <div className="policy-builder-section-index">02</div>
            <div className="policy-builder-section-body">
              <div className="policy-builder-section-heading">
                <h3>Rule</h3>
                <p>Choose exactly one action surface and the decision agentOps should return.</p>
              </div>
              <div className="policy-builder-field-grid">
                <label className="policy-builder-field">
                  <span>Action</span>
                  <select
                    name="action"
                    onChange={(event) => setSelectedAction(event.target.value)}
                    required
                    value={selectedAction}
                  >
                    {availableActions.map((candidate) => (
                      <option key={candidate.action_id} value={candidate.action_id}>
                        {candidate.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="policy-builder-field">
                  <span>Decision</span>
                  <select name="decision" onChange={(event) => setDecision(event.target.value)} required value={decision}>
                    <option value="deny">Deny</option>
                    <option value="approval_required">Require approval</option>
                    <option value="observe">Observe</option>
                  </select>
                </label>
                <label className="policy-builder-field">
                  <span>Operator role</span>
                  <select name="actorRole" onChange={(event) => setActorRole(event.target.value)} value={actorRole}>
                    <option value="">Any role</option>
                    <option value="operator">Operator</option>
                    <option value="admin">Admin</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </label>
              </div>
              <div className="policy-builder-note">
                <strong>{action.label}</strong>
                <span>{action.description}</span>
              </div>
            </div>
          </section>

          <section className="policy-builder-section">
            <div className="policy-builder-section-index">03</div>
            <div className="policy-builder-section-body">
              <div className="policy-builder-section-heading">
                <h3>Conditions</h3>
                <p>Only fields that can affect this action are shown.</p>
              </div>

              {fieldEnabled(action, 'resource') ? (
                <div className="policy-builder-field-grid">
                  <label className="policy-builder-field">
                    <span>Resource category</span>
                    <input
                      aria-label="Resource category"
                      name="resourceCategory"
                      onChange={(event) => setResourceCategory(event.target.value)}
                      placeholder="weather, market-data"
                      value={resourceCategory}
                    />
                  </label>
                  <label className="policy-builder-field">
                    <span>Resource domain</span>
                    <input
                      aria-label="Resource domain"
                      name="resourceDomain"
                      onChange={(event) => setResourceDomain(event.target.value)}
                      placeholder="api.example.com"
                      value={resourceDomain}
                    />
                  </label>
                </div>
              ) : null}

              {fieldEnabled(action, 'payment') ? (
                <div className="policy-builder-field-grid">
                  <label className="policy-builder-field">
                    <span>Payment minimum</span>
                    <input
                      aria-label="Payment minimum"
                      name="paymentMinAmount"
                      onChange={(event) => setPaymentMinAmount(event.target.value)}
                      placeholder="1.00"
                      value={paymentMinAmount}
                    />
                  </label>
                  <label className="policy-builder-field">
                    <span>Payment asset</span>
                    <input
                      aria-label="Payment asset"
                      name="paymentAsset"
                      onChange={(event) => setPaymentAsset(event.target.value)}
                      placeholder="USDC"
                      value={paymentAsset}
                    />
                  </label>
                </div>
              ) : null}

              {fieldEnabled(action, 'tool') ? (
                <label className="policy-builder-field">
                  <span>Tool name</span>
                  <input
                    aria-label="Tool name"
                    name="toolName"
                    onChange={(event) => setToolName(event.target.value)}
                    placeholder="browser.search"
                    value={toolName}
                  />
                </label>
              ) : null}

              {!fieldEnabled(action, 'resource') && !fieldEnabled(action, 'payment') && !fieldEnabled(action, 'tool') ? (
                <div className="policy-builder-empty-condition">
                  This action is controlled by its binding target. No extra condition fields are needed.
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <aside className="policy-builder-review" aria-label="Draft preview">
          <div>
            <span className="policy-builder-review-step">Review</span>
            <span className="policy-builder-review-kicker">Draft preview</span>
            <h3>{previewName}</h3>
            <p>{previewDescription}</p>
          </div>
          <dl>
            <div>
              <dt>Decision</dt>
              <dd>{formatDecision(decision)}</dd>
            </div>
            <div>
              <dt>Action</dt>
              <dd>{action.label}</dd>
            </div>
            <div>
              <dt>Matches</dt>
              <dd>{conditionSummary}</dd>
            </div>
            <div>
              <dt>Lifecycle</dt>
              <dd>Draft first. Validate and activate from the table before binding.</dd>
            </div>
          </dl>
          <button className="button-primary" type="submit">
            Create draft
          </button>
        </aside>
      </div>
    </form>
  );
}

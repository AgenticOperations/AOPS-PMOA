'use client';

import { useMemo, useState } from 'react';
import type { PolicyActionRecord, PolicyDraft, PolicyStatement } from '@/lib/policy-types';

type PolicyDraftBuilderProps = {
  readonly actions?: readonly PolicyActionRecord[] | undefined;
  readonly createAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly initialDraft?: PolicyDraft | undefined;
  readonly submitAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly submitLabel?: string | undefined;
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
    description: 'Control whether an agent may execute a supported x402 USDC payment through agentOps.',
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
const preferredActionOrder = new Map(fallbackPolicyActions.map((action, index) => [action.action_id, index]));

function fieldEnabled(action: PolicyActionRecord, section: 'payment' | 'resource' | 'tool'): boolean {
  return action.condition_groups.includes(section);
}

function formatDecision(decision: string): string {
  if (decision === 'approval_required') return 'Require approval';
  if (decision === 'observe') return 'Observe';
  return 'Deny';
}

function targetLabel(action: PolicyActionRecord): string {
  const labels = action.binding_target_types.map((type) => {
    if (type === 'org') return 'workspace';
    if (type === 'connection') return 'credential';
    return type;
  });
  return labels.join(', ');
}

function firstStatement(draft: PolicyDraft | undefined): PolicyStatement | undefined {
  return draft?.statements?.[0];
}

function joinList(values: readonly string[] | undefined): string {
  return values?.join(', ') ?? '';
}

export function PolicyDraftBuilder({
  actions = fallbackPolicyActions,
  createAction,
  initialDraft,
  submitAction,
  submitLabel,
}: PolicyDraftBuilderProps) {
  const initialStatement = firstStatement(initialDraft);
  const availableActions = useMemo(() => {
    const source = actions.length > 0 ? actions : fallbackPolicyActions;
    return [...source].sort((first, second) => {
      const firstOrder = preferredActionOrder.get(first.action_id) ?? 100;
      const secondOrder = preferredActionOrder.get(second.action_id) ?? 100;
      if (firstOrder !== secondOrder) return firstOrder - secondOrder;
      return first.label.localeCompare(second.label);
    });
  }, [actions]);
  const [selectedAction, setSelectedAction] = useState<string>(
    initialStatement?.actions?.[0] ?? defaultPolicyAction.action_id,
  );
  const [decision, setDecision] = useState(initialStatement?.decision ?? 'deny');
  const [policyName, setPolicyName] = useState(initialDraft?.name ?? '');
  const [description, setDescription] = useState(initialDraft?.description ?? '');
  const [actorRole, setActorRole] = useState(initialStatement?.actor?.roles?.[0] ?? '');
  const [resourceCategory, setResourceCategory] = useState(
    joinList(initialStatement?.conditions?.resource?.categories),
  );
  const [resourceDomain, setResourceDomain] = useState(joinList(initialStatement?.conditions?.resource?.domains));
  const [paymentMinAmount, setPaymentMinAmount] = useState(
    initialStatement?.conditions?.payment?.minAmount?.toString() ?? '',
  );
  const [paymentMaxAmount, setPaymentMaxAmount] = useState(
    initialStatement?.conditions?.payment?.maxAmount?.toString() ?? '',
  );
  const [paymentAsset, setPaymentAsset] = useState(joinList(initialStatement?.conditions?.payment?.assets));
  const [paymentNetwork, setPaymentNetwork] = useState(joinList(initialStatement?.conditions?.payment?.networks));
  const [paymentRecipient, setPaymentRecipient] = useState(
    joinList(initialStatement?.conditions?.payment?.recipients),
  );
  const [toolName, setToolName] = useState(joinList(initialStatement?.conditions?.tool?.names));
  const [toolRiskLevel, setToolRiskLevel] = useState(joinList(initialStatement?.conditions?.tool?.riskLevels));
  const selectedActionId = availableActions.some((candidate) => candidate.action_id === selectedAction)
    ? selectedAction
    : availableActions[0]?.action_id ?? defaultPolicyAction.action_id;
  const action = useMemo<PolicyActionRecord>(
    () => availableActions.find((candidate) => candidate.action_id === selectedActionId) ?? availableActions[0] ?? defaultPolicyAction,
    [availableActions, selectedActionId],
  );
  const conditionSummary = useMemo(() => {
    const conditions: string[] = [];
    if (resourceCategory.trim().length > 0) conditions.push(`category ${resourceCategory.trim()}`);
    if (resourceDomain.trim().length > 0) conditions.push(`domain ${resourceDomain.trim()}`);
    if (paymentMinAmount.trim().length > 0) conditions.push(`minimum ${paymentMinAmount.trim()}`);
    if (paymentMaxAmount.trim().length > 0) conditions.push(`maximum ${paymentMaxAmount.trim()}`);
    if (paymentAsset.trim().length > 0) conditions.push(`asset ${paymentAsset.trim()}`);
    if (paymentNetwork.trim().length > 0) conditions.push(`network ${paymentNetwork.trim()}`);
    if (paymentRecipient.trim().length > 0) conditions.push(`recipient ${paymentRecipient.trim()}`);
    if (toolName.trim().length > 0) conditions.push(`tool ${toolName.trim()}`);
    if (toolRiskLevel.trim().length > 0) conditions.push(`risk ${toolRiskLevel.trim()}`);
    if (actorRole.length > 0) conditions.push(`role ${actorRole}`);
    return conditions.length > 0 ? conditions.join(' · ') : 'No optional conditions set';
  }, [
    actorRole,
    paymentAsset,
    paymentMaxAmount,
    paymentMinAmount,
    paymentNetwork,
    paymentRecipient,
    resourceCategory,
    resourceDomain,
    toolName,
    toolRiskLevel,
  ]);
  const previewName = policyName.trim().length > 0 ? policyName.trim() : 'Untitled policy draft';
  const previewDescription =
    description.trim().length > 0
      ? description.trim()
      : `${formatDecision(decision)} · ${action.label}`;

  return (
    <form action={submitAction ?? createAction} className="policy-builder-form">
      {initialDraft === undefined ? null : (
        <>
          <input name="draftId" type="hidden" value={initialDraft.id} />
          <input name="statementId" type="hidden" value={initialStatement?.id ?? ''} />
          <input name="category" type="hidden" value={initialDraft.category} />
        </>
      )}
      <div className="policy-builder-frame">
        <aside className="policy-builder-rail" aria-label="Policy draft setup">
          <div>
            <span>Draft setup</span>
            <p className="policy-builder-rail-summary">
              Configure one action surface at a time. The form only exposes compatible match fields.
            </p>
          </div>
          <ol>
            <li>
              <span>01</span>
              <p>Define policy details</p>
            </li>
            <li>
              <span>02</span>
              <p>Select the controlled action</p>
            </li>
            <li>
              <span>03</span>
              <p>Add only valid match fields</p>
            </li>
          </ol>
        </aside>

        <div className="policy-builder-main">
          <section className="policy-builder-section">
            <div className="policy-builder-section-heading">
              <span>01</span>
              <div>
                <h3>Policy details</h3>
                <p>Name the rule so operators can recognize it before assignment.</p>
              </div>
            </div>
            <div className="policy-builder-field-grid policy-builder-details-grid">
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
          </section>

          <section className="policy-builder-section">
            <div className="policy-builder-section-heading">
              <span>02</span>
              <div>
                <h3>Action and result</h3>
                <p>Choose one policy surface. Assignment scopes come from backend metadata.</p>
              </div>
            </div>
            <div className="policy-builder-field-grid three">
              <label className="policy-builder-field">
                <span>Action</span>
                <select
                  name="action"
                  onChange={(event) => setSelectedAction(event.target.value)}
                  required
                  value={selectedActionId}
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
                  <option value="owner">Owner</option>
                  <option value="operator">Operator</option>
                  <option value="admin">Admin</option>
                  <option value="auditor">Auditor</option>
                  <option value="viewer">Viewer</option>
                  <option value="member">Member</option>
                </select>
              </label>
            </div>
            <div className="policy-builder-note">
              <strong>{action.label}</strong>
              <span>{action.description}</span>
              <em>Assignable to: {targetLabel(action)}</em>
            </div>
          </section>

          <section className="policy-builder-section">
            <div className="policy-builder-section-heading">
              <span>03</span>
              <div>
                <h3>Match conditions</h3>
                <p>Only condition groups accepted by this action are visible.</p>
              </div>
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
                  <span>Payment maximum</span>
                  <input
                    aria-label="Payment maximum"
                    name="paymentMaxAmount"
                    onChange={(event) => setPaymentMaxAmount(event.target.value)}
                    placeholder="25.00"
                    value={paymentMaxAmount}
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
                <label className="policy-builder-field">
                  <span>Payment network</span>
                  <input
                    aria-label="Payment network"
                    name="paymentNetwork"
                    onChange={(event) => setPaymentNetwork(event.target.value)}
                    placeholder="eip155:84532"
                    value={paymentNetwork}
                  />
                </label>
                <label className="policy-builder-field">
                  <span>Payment recipient</span>
                  <input
                    aria-label="Payment recipient"
                    name="paymentRecipient"
                    onChange={(event) => setPaymentRecipient(event.target.value)}
                    placeholder="0x..."
                    value={paymentRecipient}
                  />
                </label>
              </div>
            ) : null}

            {fieldEnabled(action, 'tool') ? (
              <div className="policy-builder-field-grid">
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
                <label className="policy-builder-field">
                  <span>Tool risk level</span>
                  <input
                    aria-label="Tool risk level"
                    name="toolRiskLevel"
                    onChange={(event) => setToolRiskLevel(event.target.value)}
                    placeholder="high"
                    value={toolRiskLevel}
                  />
                </label>
              </div>
            ) : null}

            {!fieldEnabled(action, 'resource') && !fieldEnabled(action, 'payment') && !fieldEnabled(action, 'tool') ? (
              <div className="policy-builder-empty-condition">
                This action is controlled by its assignment target. No extra condition fields are needed.
              </div>
            ) : null}
          </section>
        </div>

        <aside className="policy-builder-review" aria-label="Draft preview">
          <div>
            <span className="policy-builder-review-kicker">Review</span>
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
              <dd>
                {initialDraft === undefined
                  ? 'Draft first. Validate and activate before assignment.'
                  : 'Saving returns this draft to validation before it can be activated.'}
              </dd>
            </div>
          </dl>
          <button className="button-primary" type="submit">
            {submitLabel ?? (initialDraft === undefined ? 'Create draft' : 'Save draft changes')}
          </button>
        </aside>
      </div>
    </form>
  );
}

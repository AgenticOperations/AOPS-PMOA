export type {
  EffectivePolicy,
  PolicyDecisionMatch,
  PolicyDecisionRequest,
  PolicyDecisionResult,
  PolicyDecisionValue,
  PolicyDefaultEffect,
  PolicyStatement,
} from './types.js';

import type {
  EffectivePolicy,
  PolicyDecisionRequest,
  PolicyDecisionResult,
  PolicyDecisionValue,
  PolicyDefaultEffect,
  PolicyStatement,
  PolicyStatementConditions,
} from './types.js';

const decisionRank: Record<PolicyDecisionValue, number> = {
  allow: 0,
  observe: 1,
  approval_required: 2,
  deny: 3,
};

const reasonCode: Record<PolicyDecisionValue, string> = {
  allow: 'no_matching_policy',
  observe: 'policy_observed',
  approval_required: 'policy_requires_approval',
  deny: 'policy_denied',
};

const explanation: Record<PolicyDecisionValue, string> = {
  allow: 'No active policy blocked this request.',
  observe: 'A policy marked this request for observation.',
  approval_required: 'A policy requires approval before this request can continue.',
  deny: 'A policy denied this request.',
};

const NO_MATCH_DENY_REASON = 'no_matching_policy_denied';
const NO_MATCH_DENY_EXPLANATION = 'No policy authorizes this request.';

function objectAt(value: unknown, key: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const child = (value as Record<string, unknown>)[key];
  return child !== null && typeof child === 'object' && !Array.isArray(child) ? (child as Record<string, unknown>) : {};
}

function stringAt(value: Record<string, unknown>, key: string): string | null {
  const child = value[key];
  return typeof child === 'string' && child.trim().length > 0 ? child : null;
}

function numberAt(value: Record<string, unknown>, key: string): number | null {
  const child = value[key];
  if (typeof child === 'number' && Number.isFinite(child)) return child;
  if (typeof child !== 'string') return null;
  const parsed = Number(child);
  return Number.isFinite(parsed) ? parsed : null;
}

function includesIfPresent(allowed: readonly string[] | undefined, actual: string | null): boolean {
  if (allowed === undefined || allowed.length === 0) return true;
  if (actual === null) return false;
  return allowed.includes(actual);
}

function matchesResourceCondition(
  condition: NonNullable<PolicyStatementConditions['resource']>,
  context: Record<string, unknown>,
): boolean {
  const resource = objectAt(context, 'resource');
  return (
    includesIfPresent(condition.categories, stringAt(resource, 'category')) &&
    includesIfPresent(condition.domains, stringAt(resource, 'domain'))
  );
}

function matchesPaymentCondition(
  condition: NonNullable<PolicyStatementConditions['payment']>,
  context: Record<string, unknown>,
): boolean {
  const payment = objectAt(context, 'payment');
  const amount = numberAt(payment, 'amount');
  if (condition.minAmount !== undefined) {
    const minAmount = Number(condition.minAmount);
    if (!Number.isFinite(minAmount) || amount === null || amount < minAmount) return false;
  }
  if (condition.maxAmount !== undefined) {
    const maxAmount = Number(condition.maxAmount);
    if (!Number.isFinite(maxAmount) || amount === null || amount > maxAmount) return false;
  }

  return (
    includesIfPresent(condition.assets, stringAt(payment, 'asset')) &&
    includesIfPresent(condition.networks, stringAt(payment, 'network')) &&
    includesIfPresent(condition.recipients, stringAt(payment, 'recipient'))
  );
}

function matchesToolCondition(
  condition: NonNullable<PolicyStatementConditions['tool']>,
  context: Record<string, unknown>,
): boolean {
  const tool = objectAt(context, 'tool');
  return (
    includesIfPresent(condition.names, stringAt(tool, 'name')) &&
    includesIfPresent(condition.riskLevels, stringAt(tool, 'riskLevel'))
  );
}

function matchesConditions(
  conditions: PolicyStatementConditions | undefined,
  context: Record<string, unknown>,
): boolean {
  if (conditions === undefined) return true;
  if (conditions.resource !== undefined && !matchesResourceCondition(conditions.resource, context)) return false;
  if (conditions.payment !== undefined && !matchesPaymentCondition(conditions.payment, context)) return false;
  if (conditions.tool !== undefined && !matchesToolCondition(conditions.tool, context)) return false;
  return true;
}

function matchesStatement(statement: PolicyStatement, request: PolicyDecisionRequest): boolean {
  if (!statement.actions.includes('*') && !statement.actions.includes(request.action)) return false;

  const roles = statement.actor?.roles;
  if (roles !== undefined && roles.length > 0) {
    if (request.actor.role === undefined || !roles.includes(request.actor.role)) return false;
  }

  const targetTypes = statement.target?.types;
  if (targetTypes !== undefined && targetTypes.length > 0 && !targetTypes.includes(request.target.type)) {
    return false;
  }

  const targetIds = statement.target?.ids;
  if (targetIds !== undefined && targetIds.length > 0) {
    if (request.target.id === undefined || !targetIds.includes(request.target.id)) return false;
  }

  return matchesConditions(statement.conditions, request.context);
}

export function evaluatePolicyDecision(input: {
  readonly request: PolicyDecisionRequest;
  readonly policies: readonly EffectivePolicy[];
  readonly defaultEffect?: PolicyDefaultEffect;
}): PolicyDecisionResult {
  const matched = input.policies.flatMap((policy) =>
    policy.statements
      .filter((statement) => matchesStatement(statement, input.request))
      .map((statement) => ({
        policyId: policy.policyId,
        policyVersion: policy.version,
        policyName: policy.name,
        statementId: statement.id,
        decision: statement.decision,
      })),
  );

  // Fail closed: with no authored rule, the request is not authorized.
  //
  // This MUST stay a separate branch. Do not express it by seeding the
  // reduce below with 'deny' -- that fold takes the highest decisionRank,
  // so a 'deny' seed would beat every matching allow and deny everything.
  if (matched.length === 0) {
    const permissive = input.defaultEffect === 'allow';
    return {
      decision: permissive ? 'allow' : 'deny',
      enforceability: 'enforceable',
      reasonCode: permissive ? reasonCode.allow : NO_MATCH_DENY_REASON,
      explanation: permissive ? explanation.allow : NO_MATCH_DENY_EXPLANATION,
      matched: [],
    };
  }

  const decision = matched.reduce<PolicyDecisionValue>(
    (current, match) => (decisionRank[match.decision] > decisionRank[current] ? match.decision : current),
    'allow',
  );

  return {
    decision,
    enforceability: 'enforceable',
    reasonCode: reasonCode[decision],
    explanation: explanation[decision],
    matched,
  };
}

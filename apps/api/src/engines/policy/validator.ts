import type { PolicyStatement, PolicyValidationResult } from './types.js';

const allowedDecisions = new Set(['allow', 'deny', 'approval_required', 'observe']);
const allowedAuditLevels = new Set(['standard', 'detailed']);
const conditionGroups = ['resource', 'payment', 'tool'] as const;

const actionConditionSupport: Record<string, ReadonlySet<(typeof conditionGroups)[number]>> = {
  'payment.x402.authorize': new Set(['resource', 'payment']),
  'runtime.http.request': new Set(['resource']),
  'tool.call': new Set(['tool']),
};

function supportedConditionGroups(action: string): ReadonlySet<(typeof conditionGroups)[number]> {
  if (action === '*') return new Set(conditionGroups);
  if (action.startsWith('management.')) return new Set();
  return actionConditionSupport[action] ?? new Set(conditionGroups);
}

function hasValues(value: readonly unknown[] | undefined): boolean {
  return value !== undefined && value.length > 0;
}

function hasResourceCondition(statement: PolicyStatement): boolean {
  const resource = statement.conditions?.resource;
  return resource !== undefined && (hasValues(resource.categories) || hasValues(resource.domains));
}

function hasPaymentCondition(statement: PolicyStatement): boolean {
  const payment = statement.conditions?.payment;
  return (
    payment !== undefined &&
    (payment.minAmount !== undefined ||
      payment.maxAmount !== undefined ||
      hasValues(payment.assets) ||
      hasValues(payment.networks) ||
      hasValues(payment.recipients))
  );
}

function hasToolCondition(statement: PolicyStatement): boolean {
  const tool = statement.conditions?.tool;
  return tool !== undefined && (hasValues(tool.names) || hasValues(tool.riskLevels));
}

function usedConditionGroups(statement: PolicyStatement): Array<(typeof conditionGroups)[number]> {
  return [
    ...(hasResourceCondition(statement) ? (['resource'] as const) : []),
    ...(hasPaymentCondition(statement) ? (['payment'] as const) : []),
    ...(hasToolCondition(statement) ? (['tool'] as const) : []),
  ];
}

export function validatePolicyStatements(input: {
  readonly knownActions: ReadonlySet<string>;
  readonly statements: readonly PolicyStatement[];
}): PolicyValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenStatementIds = new Set<string>();

  if (input.statements.length === 0) {
    errors.push('Policy must contain at least one statement.');
  }

  for (const [index, statement] of input.statements.entries()) {
    if (statement.id.trim().length === 0) {
      errors.push(`Statement ${index + 1} is missing an id.`);
    } else if (seenStatementIds.has(statement.id)) {
      errors.push(`Statement id "${statement.id}" is duplicated.`);
    }
    seenStatementIds.add(statement.id);

    if (!allowedDecisions.has(statement.decision)) {
      errors.push(`Statement "${statement.id}" has an unsupported decision.`);
    }

    if (statement.actions.length === 0) {
      errors.push(`Statement "${statement.id}" must include at least one action.`);
    }

    for (const action of statement.actions) {
      if (action !== '*' && !input.knownActions.has(action)) {
        errors.push(`Statement "${statement.id}" references unknown action "${action}".`);
      }
    }

    const usedGroups = usedConditionGroups(statement);
    for (const group of usedGroups) {
      for (const action of statement.actions) {
        if (!supportedConditionGroups(action).has(group)) {
          errors.push(`Statement "${statement.id}" action "${action}" does not support ${group} conditions.`);
        }
      }
    }

    if (statement.conditions?.resource !== undefined && !hasResourceCondition(statement)) {
      errors.push(`Statement "${statement.id}" has an empty resource condition.`);
    }
    if (statement.conditions?.payment !== undefined && !hasPaymentCondition(statement)) {
      errors.push(`Statement "${statement.id}" has an empty payment condition.`);
    }
    if (statement.conditions?.tool !== undefined && !hasToolCondition(statement)) {
      errors.push(`Statement "${statement.id}" has an empty tool condition.`);
    }

    const payment = statement.conditions?.payment;
    if (payment?.minAmount !== undefined && !Number.isFinite(Number(payment.minAmount))) {
      errors.push(`Statement "${statement.id}" has an invalid payment minAmount.`);
    }
    if (payment?.maxAmount !== undefined && !Number.isFinite(Number(payment.maxAmount))) {
      errors.push(`Statement "${statement.id}" has an invalid payment maxAmount.`);
    }

    if (!allowedAuditLevels.has(statement.audit)) {
      errors.push(`Statement "${statement.id}" has an unsupported audit level.`);
    }

    if (statement.decision === 'allow') {
      warnings.push(`Statement "${statement.id}" allows a request but does not make enforcement stricter.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

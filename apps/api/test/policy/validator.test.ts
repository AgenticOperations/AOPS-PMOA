import { describe, expect, it } from 'vitest';
import type { PolicyConditionGroup } from '../../src/engines/policy/types.js';
import { validatePolicyStatements } from '../../src/engines/policy/validator.js';

const knownActions = new Set(['runtime.http.request', 'payment.x402.authorize', 'tool.call']);
const actionConditionGroups = new Map<string, readonly PolicyConditionGroup[]>([
  ['runtime.http.request', ['resource']],
  ['payment.x402.authorize', ['resource', 'payment']],
  ['tool.call', ['tool']],
]);

describe('Section 2 policy validator', () => {
  it('rejects condition groups that do not belong to the selected runtime action', () => {
    const validation = validatePolicyStatements({
      actionConditionGroups,
      knownActions,
      statements: [
        {
          id: 'stmt_bad_http_conditions',
          decision: 'deny',
          actions: ['runtime.http.request'],
          target: { types: ['agent'], ids: ['agt_research'] },
          conditions: {
            resource: { categories: ['weather'] },
            payment: { minAmount: '1.00', assets: ['USDC'] },
            tool: { names: ['browser.search'] },
          },
          audit: 'detailed',
        },
      ],
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes('does not support payment conditions'))).toBe(true);
    expect(validation.errors.some((error) => error.includes('does not support tool conditions'))).toBe(true);
  });
});

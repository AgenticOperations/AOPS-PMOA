import { describe, expect, it } from 'vitest';
import { buildCanonicalChecklist, CANONICAL_FLEET_GOAL } from '../../src/engines/fleet-run/types.js';

describe('fleet-run checklist', () => {
  it('builds the canonical eight-step checklist', () => {
    const checklist = buildCanonicalChecklist();
    expect(checklist).toHaveLength(8);
    expect(CANONICAL_FLEET_GOAL).toContain('SeniorReviewer');
    expect(checklist.map((item) => item.id)).toEqual([
      'onboard',
      'wire',
      'pay_data_fetcher',
      'pay_analyst',
      'second_hop',
      'pay_writer',
      'pay_reviewer',
      'activity',
    ]);
    expect(checklist.every((item) => item.required && item.status === 'pending')).toBe(true);
  });
});

import assert from 'node:assert/strict';
import { buildCanonicalChecklist, CANONICAL_FLEET_GOAL } from '../../src/engines/fleet-run/types.js';

const checklist = buildCanonicalChecklist();
assert.equal(checklist.length, 8);
assert.ok(CANONICAL_FLEET_GOAL.includes('SeniorReviewer'));
assert.deepEqual(
  checklist.map((item) => item.id),
  [
    'onboard',
    'wire',
    'pay_data_fetcher',
    'pay_analyst',
    'second_hop',
    'pay_writer',
    'pay_reviewer',
    'activity',
  ],
);
assert.ok(checklist.every((item) => item.required && item.status === 'pending'));
console.log('fleet-run checklist ok');

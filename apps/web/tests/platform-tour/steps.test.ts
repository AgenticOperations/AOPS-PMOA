import { describe, expect, it } from 'vitest';
import { assertUniqueStepTargets, stepsForPath, tourRoute } from '../../src/lib/platform-tour/steps.js';

describe('platform tour steps', () => {
  it('restores Agents sidebar → Add agent button as distinct steps', () => {
    const steps = stepsForPath('publish');
    const agents = steps.find((step) => step.id === 'agents');
    const addAgent = steps.find((step) => step.id === 'add-agent');
    expect(agents?.element).toBe('[data-tour="nav-agents"]');
    expect(addAgent?.element).toBe('[data-tour="add-agent"]');
    expect(addAgent?.route).toBe('agents');
    expect(agents?.element).not.toBe(addAgent?.element);
  });

  it('keeps unique spotlights across each path', () => {
    for (const path of ['publish', 'mcp', 'explore'] as const) {
      expect(assertUniqueStepTargets(path), path).toEqual([]);
    }
  });

  it('orders the hire path with the create beat after Agents', () => {
    expect(stepsForPath('publish').map((step) => step.id)).toEqual([
      'map',
      'agents',
      'add-agent',
      'controls',
      'fund',
      'marketplace',
      'approvals',
      'done',
    ]);
  });

  it('builds org-scoped routes when provided', () => {
    expect(tourRoute('acme', 'agents')).toBe('/app/acme/agents');
    expect(tourRoute('acme', undefined)).toBeNull();
  });
});

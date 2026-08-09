import { describe, expect, it } from 'vitest';
import { stepsForPath, tourRoute } from '../../src/lib/platform-tour/steps.js';

describe('platform tour steps', () => {
  it('includes publish-specific funding steps for the hire path', () => {
    const ids = stepsForPath('publish').map((step) => step.id);
    expect(ids).toContain('fund');
    expect(ids).toContain('empower');
    expect(ids).toContain('publish');
    expect(ids).toContain('marketplace');
    expect(ids).not.toContain('credentials');
  });

  it('emphasizes credentials for the MCP path and skips funding', () => {
    const ids = stepsForPath('mcp').map((step) => step.id);
    expect(ids).toContain('credentials');
    expect(ids).not.toContain('fund');
    expect(ids).not.toContain('empower');
    expect(ids).not.toContain('publish');
  });

  it('keeps the full map for explore', () => {
    const ids = stepsForPath('explore').map((step) => step.id);
    expect(ids).toEqual([
      'map',
      'agents',
      'add-agent',
      'controls',
      'credentials',
      'fund',
      'empower',
      'publish',
      'marketplace',
      'approvals',
      'done',
    ]);
  });

  it('builds org-scoped routes', () => {
    expect(tourRoute('acme', 'agents')).toBe('/app/acme/agents');
    expect(tourRoute('acme', undefined)).toBeNull();
  });
});

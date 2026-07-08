import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '../src/index.js';

describe('healthResponseSchema', () => {
  it('accepts the PMOA scaffold health response', () => {
    const parsed = healthResponseSchema.parse({
      ok: true,
      service: 'agentops-pmoa-api',
      version: '0.0.0',
      section: 'section_0',
    });

    expect(parsed.ok).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { nodeEnvSchema } from '../src/index.js';

describe('nodeEnvSchema', () => {
  it('defaults to development', () => {
    expect(nodeEnvSchema.parse(undefined)).toBe('development');
  });
});

import { describe, expect, it } from 'vitest';
import { scrollStepForPosition } from '../../src/components/landing/scroll-sequence.js';

describe('scrollStepForPosition', () => {
  it('maps the pinned scroll distance across four control states', () => {
    expect(scrollStepForPosition({ top: 0, height: 4000, viewport: 1000, steps: 4 })).toBe(0);
    expect(scrollStepForPosition({ top: -1000, height: 4000, viewport: 1000, steps: 4 })).toBe(1);
    expect(scrollStepForPosition({ top: -2000, height: 4000, viewport: 1000, steps: 4 })).toBe(2);
    expect(scrollStepForPosition({ top: -2999, height: 4000, viewport: 1000, steps: 4 })).toBe(3);
  });

  it('clamps before and after the sequence', () => {
    expect(scrollStepForPosition({ top: 600, height: 5000, viewport: 1000, steps: 5 })).toBe(0);
    expect(scrollStepForPosition({ top: -9000, height: 5000, viewport: 1000, steps: 5 })).toBe(4);
  });

  it('returns the first state when a sequence cannot scroll', () => {
    expect(scrollStepForPosition({ top: -200, height: 800, viewport: 1000, steps: 4 })).toBe(0);
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('next/font/google', () => ({
  Montserrat: () => ({ variable: '--font-montserrat' }),
}));

describe('application metadata', () => {
  it('uses the real AOPS image for the browser tab', async () => {
    const { metadata } = await import('../../src/app/layout.js');

    expect(metadata.icons).toEqual({
      icon: [{ sizes: '160x160', type: 'image/png', url: '/landing/aops-tab-icon.png' }],
    });
  });
});

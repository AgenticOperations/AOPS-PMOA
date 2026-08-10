import { describe, expect, it, vi } from 'vitest';

vi.mock('next/font/google', () => ({
  Montserrat: () => ({ className: 'font-montserrat', variable: '--font-montserrat' }),
  Plus_Jakarta_Sans: () => ({ className: 'font-jakarta', variable: '--font-jakarta' }),
  Great_Vibes: () => ({ className: 'font-cursive', variable: '--font-cursive' }),
}));

describe('application metadata', () => {
  it('uses the real AOPS image for the browser tab', async () => {
    const { metadata } = await import('../../src/app/layout.js');

    expect(metadata.icons).toEqual({
      icon: [{ sizes: '160x160', type: 'image/png', url: '/landing/aops-tab-icon.png' }],
    });
  });
});

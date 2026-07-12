import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChainMark } from '../../src/components/payments/ChainMark.js';

describe('ChainMark', () => {
  it.each([
    ['base', 'Base', '/landing/chains/base.png'],
    ['arbitrum', 'Arbitrum', '/landing/chains/arbitrum.svg'],
    ['polygon', 'Polygon', '/landing/chains/polygon.svg'],
    ['optimism', 'Optimism', '/landing/chains/optimism.svg'],
    ['avalanche', 'Avalanche', '/landing/chains/avalanche.svg'],
  ] as const)('uses the verified landing asset for %s everywhere in Treasury', (chain, label, source) => {
    render(<ChainMark chain={chain} />);

    expect(screen.getByRole('img', { name: label })).toHaveAttribute('src', source);
  });
});

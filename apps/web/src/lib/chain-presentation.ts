import type { PaymentChain } from './payments-types';

export const CHAIN_PRESENTATION: Readonly<Record<PaymentChain, {
  readonly logo: string;
  readonly name: string;
}>> = {
  base: { logo: '/landing/chains/base.png', name: 'Base' },
  arbitrum: { logo: '/landing/chains/arbitrum.svg', name: 'Arbitrum' },
  polygon: { logo: '/landing/chains/polygon.svg', name: 'Polygon' },
  optimism: { logo: '/landing/chains/optimism.svg', name: 'Optimism' },
  avalanche: { logo: '/landing/chains/avalanche.svg', name: 'Avalanche' },
  arc: { logo: '/landing/chains/arc.svg', name: 'Arc' },
};

const chainEntries = Object.entries(CHAIN_PRESENTATION) as readonly [
  PaymentChain,
  (typeof CHAIN_PRESENTATION)[PaymentChain],
][];

export const SUPPORTED_CHAIN_PRESENTATION = chainEntries.map(
  ([id, presentation]) => ({ id, ...presentation }),
);

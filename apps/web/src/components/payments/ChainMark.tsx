import Image from 'next/image';
import { CHAIN_PRESENTATION } from '@/lib/chain-presentation';
import type { PaymentChain } from '@/lib/payments-types';

export function ChainMark({ chain, size = 'large' }: { readonly chain: PaymentChain; readonly size?: 'small' | 'large' }) {
  const className = size === 'large' ? 'chain-mark chain-mark-large' : 'chain-mark chain-mark-small';
  const presentation = CHAIN_PRESENTATION[chain];
  // The API can return a chain this build has no artwork for -- that used to
  // throw inside render and take the whole page down. A chain the treasury
  // genuinely holds is worth showing by name even without a logo.
  if (presentation === undefined) {
    return <span aria-label={chain} className={className}>{chain.slice(0, 3).toUpperCase()}</span>;
  }
  return (
    <Image
      alt={presentation.name}
      className={className}
      height={256}
      src={presentation.logo}
      unoptimized
      width={256}
    />
  );
}

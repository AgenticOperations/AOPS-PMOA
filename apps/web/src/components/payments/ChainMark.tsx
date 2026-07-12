import Image from 'next/image';
import { CHAIN_PRESENTATION } from '@/lib/chain-presentation';
import type { PaymentChain } from '@/lib/payments-types';

export function ChainMark({ chain, size = 'large' }: { readonly chain: PaymentChain; readonly size?: 'small' | 'large' }) {
  const className = size === 'large' ? 'chain-mark chain-mark-large' : 'chain-mark chain-mark-small';
  const presentation = CHAIN_PRESENTATION[chain];
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

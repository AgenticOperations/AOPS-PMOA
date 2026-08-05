import Image from 'next/image';
import { SUPPORTED_CHAIN_PRESENTATION } from '@/lib/chain-presentation';

function ChainList({ duplicate = false }: { duplicate?: boolean }) {
  return (
    <ul aria-hidden={duplicate || undefined} aria-label={duplicate ? undefined : 'Supported networks'}>
      {SUPPORTED_CHAIN_PRESENTATION.map((chain) => (
        <li key={chain.id}>
          <Image alt="" data-chain-logo height={34} src={chain.logo} unoptimized width={34} />
          <span>{chain.name}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Hairline compatibility band directly beneath the hero. Occupies the same slot
 * Casper's ecosystem marquee does, but keeps the canonical chain assets.
 */
export function ChainMarquee() {
  return (
    <div
      aria-label="Supported chain compatibility"
      className="aops-chain-marquee"
      data-chain-marquee
      role="group"
      tabIndex={0}
    >
      <div className="aops-chain-marquee-track" data-chain-marquee-track>
        <ChainList />
        <ChainList duplicate />
      </div>
    </div>
  );
}

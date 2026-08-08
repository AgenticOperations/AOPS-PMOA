import Image from 'next/image';
import { AgentAvatar } from '@/components/agents/AgentAvatar';
import { CHAIN_PRESENTATION } from '@/lib/chain-presentation';
import type { PaymentChain } from '@/lib/payments-types';

type MarketplaceListingMarkProps = {
  readonly kind: 'agent' | 'service';
  readonly name: string;
  readonly agentId: string | null;
  readonly listingId: string;
  readonly size?: 'sm' | 'md' | 'lg';
};

const serviceIconPx = { sm: 18, md: 22, lg: 28 } as const;

function ServiceGlyph({ size }: { readonly size: 'sm' | 'md' | 'lg' }) {
  const px = serviceIconPx[size];
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={px}
      viewBox="0 0 24 24"
      width={px}
    >
      <path
        d="M12 3.2 19.2 7.4v9.2L12 20.8 4.8 16.6V7.4L12 3.2Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <circle cx="12" cy="12" fill="currentColor" r="2.1" />
      <path
        d="M12 7.4v2.4M12 14.2v2.4M8.2 9.8l2.1 1.2M13.7 13l2.1 1.2M15.8 9.8l-2.1 1.2M10.3 13l-2.1 1.2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** Robot face for agents; geometric service glyph for hireable endpoints. */
export function MarketplaceListingMark({
  kind,
  name,
  agentId,
  listingId,
  size = 'sm',
}: MarketplaceListingMarkProps) {
  if (kind === 'agent') {
    return (
      <AgentAvatar
        agentId={agentId ?? listingId}
        className="amkt-avatar"
        name={name}
        size={size === 'lg' ? 'md' : size}
      />
    );
  }

  return (
    <span aria-hidden="true" className={`amkt-service-mark is-${size}`} title={name}>
      <ServiceGlyph size={size} />
    </span>
  );
}

type MarketplaceChainChipProps = {
  readonly chain: string;
  readonly className?: string | undefined;
};

function isPaymentChain(value: string): value is PaymentChain {
  return value in CHAIN_PRESENTATION;
}

/** Chain logo + label — no chip background, just the mark and name. */
export function MarketplaceChainChip({ chain, className }: MarketplaceChainChipProps) {
  const presentation = isPaymentChain(chain) ? CHAIN_PRESENTATION[chain] : undefined;
  const label = presentation?.name ?? chain;

  return (
    <span className={['amkt-chain-chip', className].filter(Boolean).join(' ')}>
      {presentation !== undefined ? (
        <Image
          alt=""
          aria-hidden="true"
          className="amkt-chain-logo"
          height={16}
          src={presentation.logo}
          unoptimized
          width={16}
        />
      ) : null}
      <span>{label}</span>
    </span>
  );
}

import Link from 'next/link';
import type { PaymentChain } from '@/lib/payments-types';
import { revokeTrustAction, trustExternalAgentAction } from '@/app/actions/payments';
import { TrustedBadge } from './TrustedBadge';
import { TrustAgentPanel, type EscrowEvidence } from './TrustAgentPanel';

export type TrustGraduationTarget = {
  readonly chain: PaymentChain;
  readonly address: string;
  readonly evidence: EscrowEvidence;
  readonly trusted: boolean;
};

type TrustGraduationSectionProps = {
  readonly orgId: string;
  readonly orgSlug: string;
  readonly targets: readonly TrustGraduationTarget[];
};

/**
 * Escrow → Permit2 graduation for external counterparties this org has hired.
 * Mounted on Empower (Access). Promotion is always a human act with an explicit ceiling.
 */
export function TrustGraduationSection({ orgId, orgSlug, targets }: TrustGraduationSectionProps) {
  return (
    <section aria-labelledby="trust-graduation-title" className="trust-graduation-section">
      <div className="trust-graduation-heading">
        <div>
          <h2 id="trust-graduation-title">Escrow → Permit2 trust</h2>
          <p>
            After settled escrow jobs with an external provider, review the record and graduate them
            to a standing Permit2 ceiling (cheaper drawdowns). Not automatic — you choose the ceiling.
            Completed escrow also earns the seller agent +100 reputation (see Agents / marketplace).
          </p>
        </div>
        <span>{targets.length}</span>
      </div>

      {targets.length === 0 ? (
        <div className="treasury-empty-state">
          <strong>No escrow counterparties yet</strong>
          <p>
            Hire an external agent via{' '}
            <Link className="action-nav-link" href={`/app/${orgSlug}/marketplace`}>
              Marketplace
            </Link>{' '}
            with escrow. Completed jobs appear here so you can trust them onto Permit2.
          </p>
        </div>
      ) : (
        <ul className="trust-graduation-list">
          {targets.map((target) => (
            <li className="trust-graduation-card" key={`${target.chain}:${target.address}`}>
              <div className="trust-graduation-card-head">
                <TrustedBadge trusted={target.trusted} />
                <div>
                  <strong>{target.chain}</strong>
                  <code>{target.address}</code>
                </div>
              </div>
              <TrustAgentPanel
                evidence={target.evidence}
                revokeAction={revokeTrustAction.bind(null, orgId, orgSlug, target.chain, target.address)}
                trustAction={trustExternalAgentAction.bind(null, orgId, orgSlug, target.chain, target.address)}
                trusted={target.trusted}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

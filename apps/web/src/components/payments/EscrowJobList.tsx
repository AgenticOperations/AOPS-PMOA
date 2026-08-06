import type { SupportedChainKey } from '@/lib/wallet-chains';

const CHAIN_LABELS: Record<SupportedChainKey, string> = {
  arc: 'Arc testnet',
  base: 'Base Sepolia',
};

const EXPLORER_TX_BASE: Record<SupportedChainKey, string> = {
  arc: 'https://testnet.arcscan.app/tx/',
  base: 'https://sepolia.basescan.org/tx/',
};

// Mirrors escrow.ts's EscrowState -- open/funded/submitted are in-flight,
// completed/rejected/expired are terminal. expired and rejected refund the
// client identically on-chain, but they mean different things to a human
// deciding whether to trust this counterparty, so the label must not blur
// them into one generic "failed" bucket.
export type EscrowJobState = 'open' | 'funded' | 'submitted' | 'completed' | 'rejected' | 'expired';

export type EscrowJobSummary = {
  readonly id: string;
  readonly state: EscrowJobState;
  readonly budgetUsdc: string;
  // The most recent on-chain tx for this job (terminal, else submit/fund/create).
  readonly txHash: string | null;
};

type Props = {
  readonly jobs: readonly EscrowJobSummary[];
  readonly chain: SupportedChainKey;
};

const STATE_LABELS: Record<EscrowJobState, string> = {
  open: 'Open',
  funded: 'Funded',
  submitted: 'Submitted',
  completed: 'Completed',
  rejected: 'Rejected',
  expired: 'Expired',
};

/**
 * An agent's on-chain escrow record: one row per job, each linking out to a
 * real block-explorer transaction rather than asking the operator to trust
 * our summary of it.
 */
export function EscrowJobList({ jobs, chain }: Props) {
  if (jobs.length === 0) {
    return (
      <div className="escrow-job-list-empty">
        <p>No escrow jobs yet on {CHAIN_LABELS[chain]}.</p>
      </div>
    );
  }

  return (
    <table className="escrow-job-list">
      <thead>
        <tr>
          <th>Job</th>
          <th>State</th>
          <th>Budget</th>
          <th>
            <span className="sr-only">Transaction</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr id={job.id} key={job.id}>
            <td>{job.id}</td>
            <td>{STATE_LABELS[job.state]}</td>
            <td>{job.budgetUsdc} USDC</td>
            <td>
              {job.txHash === null ? null : (
                <a
                  href={`${EXPLORER_TX_BASE[chain]}${job.txHash}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  View
                </a>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

import type { FleetChecklistItem, FleetRunRecord } from '../fleet-run/types.js';

const EXPLORER_TX: Readonly<Record<string, string>> = {
  arc: 'https://testnet.arcscan.app/tx/',
  base: 'https://sepolia.basescan.org/tx/',
};

function statusMark(status: FleetChecklistItem['status']): string {
  if (status === 'done') return '✓';
  if (status === 'running' || status === 'failed') return '✗';
  if (status === 'skipped') return '–';
  return '○';
}

function shortTx(hash: unknown): string {
  if (typeof hash !== 'string' || hash.length < 12) return typeof hash === 'string' ? hash : '—';
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

function explorerUrl(chain: unknown, txHash: unknown): string | null {
  if (typeof chain !== 'string' || typeof txHash !== 'string' || !txHash.startsWith('0x')) return null;
  const base = EXPLORER_TX[chain];
  return base === undefined ? null : `${base}${txHash}`;
}

function receiptsFromFruit(fruit: Record<string, unknown> | null): Array<Record<string, unknown>> {
  if (fruit === null) return [];
  const receipts = fruit.receipts;
  if (!Array.isArray(receipts)) return [];
  return receipts.filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object');
}

/**
 * Operator-facing workflow + tx summary for Chat (success or failure).
 * Surfaces completed steps, on-chain payments with explorer links, remaining work, and the stop reason.
 */
export function formatFleetRunChatReply(run: FleetRunRecord): string {
  const parts: string[] = [];
  const failed = run.status === 'failed';
  const wire = run.events.find((e) => e.kind === 'wire');
  const catalogMode = wire?.payload?.catalog_mode === true;

  parts.push(failed ? `Fleet run stopped (${run.status}).` : `Fleet run ${run.status}.`);
  if (run.goal.trim()) {
    parts.push(`Goal: ${run.goal.trim().slice(0, 240)}${run.goal.length > 240 ? '…' : ''}`);
  }

  parts.push('');
  parts.push('Workflow:');
  for (const item of run.checklist) {
    const mark = statusMark(item.status);
    const suffix = item.status === 'failed'
      ? ' — failed here'
      : item.status === 'running'
        ? ' — was running'
        : '';
    parts.push(`  ${mark} ${item.label}${suffix}`);
  }

  const fruitReceipts = receiptsFromFruit(run.fruit);
  const failedEvent = [...run.events].reverse().find((e) => e.kind === 'failed');
  const progressReceipts = Array.isArray(failedEvent?.payload?.receipts_so_far)
    ? (failedEvent!.payload.receipts_so_far as unknown[]).filter(
      (row): row is Record<string, unknown> => row !== null && typeof row === 'object',
    )
    : [];
  const namedReceipts = fruitReceipts.length > 0 ? fruitReceipts : progressReceipts;
  const eventPayments = run.events.filter((e) => e.kind === 'payment');
  parts.push('');
  if (namedReceipts.length > 0) {
    parts.push(`Transactions completed (${namedReceipts.length}):`);
    namedReceipts.forEach((row, index) => {
      const payer = typeof row.payer === 'string' ? row.payer : 'payer';
      const payee = typeof row.payee === 'string' ? row.payee : 'payee';
      const chain = typeof row.chain === 'string' ? row.chain : '?';
      const amount = row.amountUsdc !== undefined ? String(row.amountUsdc) : '?';
      const hash = typeof row.txHash === 'string' ? row.txHash : null;
      const step = typeof row.step === 'string' ? row.step : `tx${index + 1}`;
      const link = explorerUrl(chain, hash);
      parts.push(`  ${index + 1}. [${step}] ${payer} → ${payee} · ${chain} · ${amount} USDC · ${shortTx(hash)}`);
      if (link !== null) parts.push(`     ${link}`);
    });
  } else if (eventPayments.length > 0) {
    parts.push(`Transactions completed (${eventPayments.length}):`);
    eventPayments.forEach((event, index) => {
      const p = event.payload;
      const hop = p.second_hop === true ? ' [second-hop]' : '';
      const chain = typeof p.chain === 'string' ? p.chain : '?';
      const amount = p.amount_usdc !== undefined ? String(p.amount_usdc) : '?';
      const hash = typeof p.tx_hash === 'string' ? p.tx_hash : null;
      const link = explorerUrl(chain, hash);
      parts.push(`  ${index + 1}.${hop} ${chain} · ${amount} USDC · ${shortTx(hash)}`);
      if (link !== null) parts.push(`     ${link}`);
    });
  } else {
    parts.push('Transactions completed (0): none on-chain yet.');
  }

  const catalogServices = run.events.filter((e) => e.kind === 'service' && e.payload?.fulfillment === 'catalog');
  if (catalogServices.length > 0 || catalogMode) {
    parts.push('');
    parts.push(
      `Catalog/offline fulfillments: ${catalogServices.length || 'yes'} — those steps did not settle on-chain.`,
    );
  }

  const remaining = run.checklist.filter((item) => item.status === 'pending' || item.status === 'running');
  const failedItems = run.checklist.filter((item) => item.status === 'failed');
  parts.push('');
  if (failedItems.length > 0 || remaining.length > 0) {
    parts.push('Remaining / blocked:');
    for (const item of failedItems) {
      parts.push(`  ✗ ${item.label}`);
    }
    for (const item of remaining) {
      parts.push(`  ○ ${item.label}`);
    }
  } else if (!failed) {
    parts.push('Remaining: none — all checklist steps done.');
  }

  if (failed && run.error) {
    parts.push('');
    parts.push(`Stopped because: ${run.error}`);
    if (/insufficient|asset amount owned by the wallet/i.test(run.error)) {
      const failedPay = failedItems.find((item) => item.id.startsWith('pay_'))
        ?? run.checklist.find((item) => item.status === 'failed');
      if (failedPay?.id === 'pay_reviewer') {
        parts.push(
          'Next: SeniorReviewer settles on Base Sepolia. Fund Orchestrator’s Base wallet with USDC (and a little ETH for gas) on Fund → Base, then re-run Chat. Arc payments above already settled.',
        );
      } else {
        parts.push(
          'Next: fund the paying agent wallet (usually Orchestrator on Arc, or Analyst for the second hop) on Fund, wait for balance, then re-run Chat.',
        );
      }
    }
  }

  const fruitText =
    typeof run.fruit?.text === 'string'
      ? run.fruit.text
      : typeof run.fruit?.brief === 'string'
        ? run.fruit.brief
        : null;
  if (fruitText && !failed) {
    parts.push('');
    parts.push(fruitText);
  }

  return parts.join('\n');
}

/** Clickable explorer links for Chat's link row (external Arc/Base explorers). */
export function fleetRunTxLinks(run: FleetRunRecord): Array<{ readonly label: string; readonly href: string }> {
  const links: Array<{ readonly label: string; readonly href: string }> = [];
  const fruitReceipts = receiptsFromFruit(run.fruit);
  const failedEvent = [...run.events].reverse().find((e) => e.kind === 'failed');
  const progressReceipts = Array.isArray(failedEvent?.payload?.receipts_so_far)
    ? (failedEvent!.payload.receipts_so_far as unknown[]).filter(
      (row): row is Record<string, unknown> => row !== null && typeof row === 'object',
    )
    : [];
  const named = fruitReceipts.length > 0 ? fruitReceipts : progressReceipts;
  if (named.length > 0) {
    named.forEach((row, index) => {
      const payee = typeof row.payee === 'string' ? row.payee : `tx${index + 1}`;
      const chain = row.chain;
      const hash = row.txHash;
      const href = explorerUrl(chain, hash);
      if (href !== null) links.push({ label: `${payee} tx`, href });
    });
    return links;
  }
  for (const event of run.events) {
    if (event.kind !== 'payment') continue;
    const href = explorerUrl(event.payload.chain, event.payload.tx_hash);
    if (href === null) continue;
    const hop = event.payload.second_hop === true ? '2nd hop' : 'hire';
    const chain = typeof event.payload.chain === 'string' ? event.payload.chain : 'tx';
    links.push({ label: `${hop} ${chain}`, href });
  }
  return links;
}

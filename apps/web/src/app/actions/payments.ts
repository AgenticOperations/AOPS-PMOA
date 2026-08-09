'use server';

import { revalidatePath } from 'next/cache';
import {
  authorizeMarketplaceDestination,
  bridgeExactWalletTopUp,
  cancelLiquidityJob,
  createCircleTreasury,
  createEscrowJob,
  createTreasury,
  hireMarketplaceX402,
  initiateGatewayDeposit,
  PaymentsApiError,
  reconcileCircleProviderJobs,
  requestTestnetFunds,
  retryLiquidityJob,
  revokeTrust,
  setProviderMode,
  setAgentPaymentAccess,
  trustExternalAgent,
  verifyPaymentRails,
  verifyPaymentRail,
} from '@/lib/server/payments-client';
import { randomUUID } from 'node:crypto';
import type { PaymentChain, PaymentMode, PaymentRail } from '@/lib/payments-types';

export type MarketplaceHireActionState = {
  readonly error?: string | undefined;
  readonly ok?: string | undefined;
  readonly jobId?: string | undefined;
};

/**
 * Server Actions that throw surface as an opaque Next.js digest in production
 * ("An error occurred in the Server Components render…"). Catch + return a
 * plain string state instead — same pattern as registerOnchainIdentityAction.
 */
function friendlyMarketplaceHireError(error: unknown, fallback: string): string {
  const code = error instanceof PaymentsApiError ? error.code : null;
  const message = error instanceof Error ? error.message : '';

  if (
    code === 'escrow_client_wallet_not_found'
    || code === 'provider_wallet_missing'
    || message.includes('escrow_client_wallet_not_found')
    || message.includes('provider_wallet_missing')
  ) {
    return 'Paying agent has no active wallet on this chain. Grant payment access on the agent Overview → Spend, wait until the wallet is active, then retry.';
  }
  if (
    code === 'escrow_client_wallet_unfunded'
    || message.includes('escrow_client_wallet_unfunded')
    || message.includes('has 0 Arc USDC')
    || message.includes('has 0 USDC')
  ) {
    return message.trim().length > 0 && !message.startsWith('escrow_') && !message.startsWith('circle_')
      ? message
      : 'Paying agent wallet has no USDC. Fund that exact wallet on Fund, then retry.';
  }
  if (
    code === 'escrow_client_cannot_be_provider'
    || code === 'marketplace_hire_self'
    || message.includes('escrow_client_cannot_be_provider')
    || message.includes('marketplace_hire_self')
    || message.toLowerCase().includes('cannot hire itself')
  ) {
    return 'Paying agent cannot hire itself — choose a different paying agent than the listing.';
  }
  if (code === 'destination_not_authorized' || message.includes('destination_not_authorized')) {
    return 'Authorize this marketplace payTo destination before micropay hire.';
  }
  if (
    code === 'circle_permit2_transaction_failed'
    || code === 'circle_permit2_transaction_denied'
    || code === 'circle_worker_operation_failed'
    || message.includes('circle_permit2_transaction_')
    || message.includes('circle_worker_operation_failed')
  ) {
    return message.trim().length > 0 && !message.startsWith('circle_')
      ? message
      : 'On-chain hire failed from the paying agent wallet. Common causes: 0 USDC on that wallet, or hiring the same agent as payer. Fund on Fund or pick a different payer, then retry.';
  }
  if (code !== null && code.startsWith('intra_fleet_')) {
    return message.trim().length > 0 && !message.startsWith('intra_fleet_')
      ? message
      : 'Permit2 fleet hire failed. Ensure the paying agent is funded on Fund and the seller endpoint is reachable, then retry.';
  }
  if (code === 'circle_worker_unavailable' || message.includes('worker is unavailable')) {
    return 'Circle wallet worker is unavailable. Try again in a moment.';
  }
  if (message.trim().length > 0 && !message.startsWith('circle_') && !message.startsWith('intra_fleet_')) {
    return message;
  }
  return fallback;
}

function paymentsPath(orgSlug: string): string {
  return `/app/${orgSlug}/payments`;
}

/**
 * Revalidates the payments console after a mutation.
 *
 * The 'layout' type is load-bearing. Every panel an operator actually edits
 * lives in a NESTED route -- agent-access, sources, delegations, funding,
 * liquidity, activity -- and revalidating the bare payments path refreshes
 * only the index page, leaving all of them serving stale server props.
 *
 * The symptom is a save that looks lost: the POST succeeds and the database
 * is correct, but the panel rehydrates from cached props and shows the old
 * value, so the operator re-enters it and saves again.
 */
function revalidatePayments(orgSlug: string): void {
  revalidatePath(paymentsPath(orgSlug), 'layout');
  revalidatePath(`/app/${orgSlug}/agents`, 'layout');
}

function stringField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function requiredStringField(formData: FormData, key: string): string {
  const value = stringField(formData, key);
  if (value.length === 0) throw new Error(`${key} is required`);
  return value;
}

function moneyField(formData: FormData, key: string): string {
  const value = requiredStringField(formData, key);
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error(`${key} must be a USDC amount`);
  return value;
}

function optionalMoneyField(formData: FormData, key: string): string | null {
  const value = stringField(formData, key);
  if (value.length === 0) return null;
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error(`${key} must be a USDC amount`);
  return value;
}

function statusField(formData: FormData): 'active' | 'disabled' {
  return stringField(formData, 'status') === 'disabled' ? 'disabled' : 'active';
}

function modeField(formData: FormData): PaymentMode {
  return stringField(formData, 'mode') === 'live' ? 'live' : 'test';
}

// These allowlists are the last gate before a value reaches the API, and
// anything absent is dropped SILENTLY -- railFields filters rather than
// throws. Arc was missing from all three, so checking "Exact · Arc" and
// saving produced a successful POST whose payload never contained it, and
// the panel came back unchecked.
//
// Arc is test-mode only: contractConfig throws arc_mainnet_not_supported for
// live, because Arc mainnet does not exist. That is the API's call to make
// and it fails loudly, so these lists stay mode-agnostic.
const PAYMENT_CHAINS = new Set<PaymentChain>([
  'arbitrum',
  'avalanche',
  'base',
  'optimism',
  'polygon',
  'arc',
]);

function chainField(formData: FormData, key = 'chain'): PaymentChain {
  const value = stringField(formData, key);
  if (PAYMENT_CHAINS.has(value as PaymentChain)) return value as PaymentChain;
  throw new Error(`${key} is invalid`);
}

function chainFields(formData: FormData): PaymentChain[] {
  const chains = formData
    .getAll('chains')
    .filter((value): value is PaymentChain => typeof value === 'string' && PAYMENT_CHAINS.has(value as PaymentChain));
  if (chains.length === 0) throw new Error('At least one chain is required');
  return [...new Set(chains)];
}

const PAYMENT_RAILS = new Set<PaymentRail>([
  'gateway_base',
  'gateway_arbitrum',
  'gateway_polygon',
  'gateway_optimism',
  'gateway_avalanche',
  'gateway_arc',
  'exact_base',
  'exact_arbitrum',
  'exact_polygon',
  'exact_optimism',
  'exact_avalanche',
  'exact_arc',
]);

function railFields(formData: FormData): PaymentRail[] {
  const rails = formData
    .getAll('allowedRails')
    .filter((value): value is PaymentRail => typeof value === 'string' && PAYMENT_RAILS.has(value as PaymentRail));
  return [...new Set(rails)];
}

function railField(formData: FormData, key = 'rail'): PaymentRail {
  const value = stringField(formData, key);
  if (PAYMENT_RAILS.has(value as PaymentRail)) return value as PaymentRail;
  throw new Error(`${key} is invalid`);
}

export async function setProviderModeAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await setProviderMode(orgId, { mode: modeField(formData) });
  revalidatePayments(orgSlug);
}

export async function createCircleTreasuryAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await createCircleTreasury(orgId, {
    label: requiredStringField(formData, 'label'),
  });
  revalidatePayments(orgSlug);
}

export async function initiateGatewayDepositAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await initiateGatewayDeposit(orgId, {
    amount_usdc: moneyField(formData, 'amount'),
    chain: chainField(formData),
  });
  revalidatePayments(orgSlug);
}

export async function requestTestnetFundsAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await requestTestnetFunds(orgId, {
    chains: chainFields(formData),
  });
  revalidatePayments(orgSlug);
}

export async function reconcileCircleProviderJobsAction(orgId: string, orgSlug: string): Promise<void> {
  await reconcileCircleProviderJobs(orgId);
  revalidatePayments(orgSlug);
}

export async function bridgeExactWalletTopUpAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await bridgeExactWalletTopUp(orgId, {
    amount_usdc: moneyField(formData, 'amount'),
    from_chain: chainField(formData, 'fromChain'),
    to_chain: chainField(formData, 'toChain'),
  });
  revalidatePayments(orgSlug);
}

export async function retryLiquidityJobAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await retryLiquidityJob(orgId, requiredStringField(formData, 'jobId'));
  revalidatePayments(orgSlug);
}

export async function cancelLiquidityJobAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await cancelLiquidityJob(orgId, requiredStringField(formData, 'jobId'));
  revalidatePayments(orgSlug);
}

export async function verifyPaymentRailAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await verifyPaymentRail(orgId, railField(formData));
  revalidatePayments(orgSlug);
}

export async function verifyUnverifiedPaymentRailsAction(orgId: string, orgSlug: string): Promise<void> {
  await verifyPaymentRails(orgId, { only_unverified: true });
  revalidatePayments(orgSlug);
}

export async function createTreasuryAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await createTreasury(orgId, {
    chain: chainField(formData),
    label: requiredStringField(formData, 'label'),
    treasury_type: 'gateway',
  });
  revalidatePayments(orgSlug);
}

// TrustAgentPanel calls these directly as functions (bound per external
// agent to its chain + address), not through a <form action> -- that is why
// they take a plain object rather than FormData.

export async function trustExternalAgentAction(
  orgId: string,
  orgSlug: string,
  chain: PaymentChain,
  address: string,
  input: { readonly label: string; readonly ceilingUsdc: string; readonly expiresAt: string },
): Promise<void> {
  await trustExternalAgent(orgId, chain, address, {
    label: input.label,
    ceiling_usdc: input.ceilingUsdc,
    expires_at: input.expiresAt,
  });
  revalidatePayments(orgSlug);
}

export async function revokeTrustAction(
  orgId: string,
  orgSlug: string,
  chain: PaymentChain,
  address: string,
): Promise<void> {
  await revokeTrust(orgId, chain, address);
  revalidatePayments(orgSlug);
}

export async function setAgentPaymentAccessAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await setAgentPaymentAccess(orgId, requiredStringField(formData, 'agentId'), {
    allowed_rails: railFields(formData),
    budget_usdc: moneyField(formData, 'budget'),
    // An agent needs its own on-chain address to be paid, to be delegated
    // to, and to submit its own drawdowns. This was hardcoded false, so
    // every agent granted access through the console came out with no
    // wallet -- it could not receive a payment or appear as a delegation
    // payee. Developer-controlled wallets make this cheap: one entity
    // secret provisions them, with no per-agent key or login.
    dedicated_wallet_required: true,
    approval_threshold_usdc: optionalMoneyField(formData, 'approvalThreshold'),
    per_request_cap_usdc: moneyField(formData, 'perRequestCap'),
    status: statusField(formData),
  });
  revalidatePayments(orgSlug);
}

export async function authorizeMarketplaceDestinationAction(
  orgId: string,
  orgSlug: string,
  formData: FormData,
): Promise<MarketplaceHireActionState> {
  try {
    const confirmed = formData.get('confirmed')?.toString() === 'true';
    if (!confirmed) {
      return { error: 'Confirm authorization before allowing this marketplace payTo.' };
    }
    await authorizeMarketplaceDestination(orgId, {
      chain: requiredStringField(formData, 'chain') as PaymentChain,
      address: requiredStringField(formData, 'address'),
      label: formData.get('label')?.toString().trim() || 'Marketplace seller',
    });
    revalidatePath(`/app/${orgSlug}/marketplace`, 'page');
    revalidatePath('/marketplace', 'layout');
    revalidatePayments(orgSlug);
    return { ok: 'Destination authorized.' };
  } catch (error) {
    return { error: friendlyMarketplaceHireError(error, 'Authorization failed.') };
  }
}

export async function hireMarketplaceX402Action(
  orgId: string,
  orgSlug: string,
  formData: FormData,
): Promise<MarketplaceHireActionState> {
  try {
    const listingId = requiredStringField(formData, 'listingId');
    await hireMarketplaceX402(orgId, {
      client_agent_id: requiredStringField(formData, 'clientAgentId'),
      listing_id: listingId,
      idempotency_key: formData.get('idempotencyKey')?.toString().trim() || `mkt-x402-${randomUUID()}`,
    });
    revalidatePath(`/app/${orgSlug}/marketplace`, 'page');
    revalidatePath(`/marketplace/${encodeURIComponent(listingId)}`, 'page');
    revalidatePayments(orgSlug);
    return { ok: 'Payment submitted. It will show under Purchases in your console.' };
  } catch (error) {
    return { error: friendlyMarketplaceHireError(error, 'Payment failed.') };
  }
}

export async function hireMarketplaceEscrowAction(
  orgId: string,
  orgSlug: string,
  formData: FormData,
): Promise<MarketplaceHireActionState> {
  try {
    const providerAddress = formData.get('providerAddress')?.toString().trim();
    const providerAgentId = formData.get('providerAgentId')?.toString().trim();
    const job = await createEscrowJob(orgId, {
      client_agent_id: requiredStringField(formData, 'clientAgentId'),
      ...(providerAgentId !== undefined && providerAgentId.length > 0
        ? { provider_agent_id: providerAgentId }
        : {}),
      ...(providerAddress !== undefined && providerAddress.length > 0
        ? { provider_address: providerAddress }
        : {}),
      chain: (formData.get('chain')?.toString().trim() || 'arc') as PaymentChain,
      budget_usdc: moneyField(formData, 'budgetUsdc'),
      expires_in_hours: Number.parseInt(formData.get('expiresInHours')?.toString() ?? '72', 10) || 72,
      description: formData.get('description')?.toString().trim() || undefined,
    });
    revalidatePath(`/app/${orgSlug}/marketplace`, 'page');
    revalidatePath(`/app/${orgSlug}/activity`, 'page');
    revalidatePath('/marketplace', 'layout');
    revalidatePayments(orgSlug);
    return {
      jobId: job.id,
      ok: `Escrow job ${job.id} created — track it in Purchases / Activity.`,
    };
  } catch (error) {
    return { error: friendlyMarketplaceHireError(error, 'Escrow hire failed.') };
  }
}

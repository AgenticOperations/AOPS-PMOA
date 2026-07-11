'use server';

import { revalidatePath } from 'next/cache';
import {
  bridgeExactWalletTopUp,
  cancelLiquidityJob,
  createCircleTreasury,
  createPaymentSource,
  createTreasury,
  initiateGatewayDeposit,
  reconcileCircleProviderJobs,
  requestTestnetFunds,
  retryLiquidityJob,
  setProviderMode,
  setAgentPaymentAccess,
  verifyPaymentRails,
  verifyPaymentRail,
} from '@/lib/server/payments-client';
import type { PaymentChain, PaymentMode, PaymentRail } from '@/lib/payments-types';

function paymentsPath(orgSlug: string): string {
  return `/app/${orgSlug}/payments`;
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

function chainField(formData: FormData, key = 'chain'): PaymentChain {
  const value = stringField(formData, key);
  if (value === 'arbitrum' || value === 'avalanche' || value === 'base' || value === 'optimism' || value === 'polygon') {
    return value;
  }
  throw new Error(`${key} is invalid`);
}

function chainFields(formData: FormData): PaymentChain[] {
  const chains = formData.getAll('chains').filter((value): value is PaymentChain => (
    value === 'arbitrum' ||
    value === 'avalanche' ||
    value === 'base' ||
    value === 'optimism' ||
    value === 'polygon'
  ));
  if (chains.length === 0) throw new Error('At least one chain is required');
  return [...new Set(chains)];
}

const PAYMENT_RAILS = new Set<PaymentRail>([
  'gateway_base',
  'gateway_arbitrum',
  'gateway_polygon',
  'gateway_optimism',
  'gateway_avalanche',
  'exact_base',
  'exact_arbitrum',
  'exact_polygon',
  'exact_optimism',
  'exact_avalanche',
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

function sourceTypeForRail(rail: PaymentRail): 'direct_exact' | 'gateway' {
  return rail.startsWith('gateway_') ? 'gateway' : 'direct_exact';
}

function providerField(formData: FormData, rail: PaymentRail): 'circle_gateway' | 'circle_wallets' | 'manual' | 'simulation' {
  const value = stringField(formData, 'provider');
  if (value === 'circle_gateway' || value === 'circle_wallets' || value === 'manual' || value === 'simulation') {
    return value;
  }
  return rail.startsWith('gateway_') ? 'circle_gateway' : 'circle_wallets';
}

export async function setProviderModeAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await setProviderMode(orgId, { mode: modeField(formData) });
  revalidatePath(paymentsPath(orgSlug));
}

export async function createCircleTreasuryAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await createCircleTreasury(orgId, {
    label: requiredStringField(formData, 'label'),
  });
  revalidatePath(paymentsPath(orgSlug));
}

export async function initiateGatewayDepositAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await initiateGatewayDeposit(orgId, {
    amount_usdc: moneyField(formData, 'amount'),
    chain: chainField(formData),
  });
  revalidatePath(paymentsPath(orgSlug));
}

export async function requestTestnetFundsAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await requestTestnetFunds(orgId, {
    chains: chainFields(formData),
  });
  revalidatePath(paymentsPath(orgSlug));
}

export async function reconcileCircleProviderJobsAction(orgId: string, orgSlug: string): Promise<void> {
  await reconcileCircleProviderJobs(orgId);
  revalidatePath(paymentsPath(orgSlug));
}

export async function bridgeExactWalletTopUpAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await bridgeExactWalletTopUp(orgId, {
    amount_usdc: moneyField(formData, 'amount'),
    from_chain: chainField(formData, 'fromChain'),
    to_chain: chainField(formData, 'toChain'),
  });
  revalidatePath(paymentsPath(orgSlug));
}

export async function retryLiquidityJobAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await retryLiquidityJob(orgId, requiredStringField(formData, 'jobId'));
  revalidatePath(paymentsPath(orgSlug));
}

export async function cancelLiquidityJobAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await cancelLiquidityJob(orgId, requiredStringField(formData, 'jobId'));
  revalidatePath(paymentsPath(orgSlug));
}

export async function verifyPaymentRailAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await verifyPaymentRail(orgId, railField(formData));
  revalidatePath(paymentsPath(orgSlug));
}

export async function verifyUnverifiedPaymentRailsAction(orgId: string, orgSlug: string): Promise<void> {
  await verifyPaymentRails(orgId, { only_unverified: true });
  revalidatePath(paymentsPath(orgSlug));
}

export async function createTreasuryAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await createTreasury(orgId, {
    chain: chainField(formData),
    label: requiredStringField(formData, 'label'),
    treasury_type: 'gateway',
  });
  revalidatePath(paymentsPath(orgSlug));
}

export async function createGatewaySourceAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  const rail = railField(formData);
  const provider = providerField(formData, rail);
  await createPaymentSource(orgId, {
    account_type: rail.startsWith('gateway_') ? 'virtual' : 'sca',
    address: stringField(formData, 'address') || null,
    chain: chainField(formData),
    external_wallet_id: stringField(formData, 'externalWalletId') || null,
    label: requiredStringField(formData, 'label'),
    provider,
    rail,
    simulated_balance_usdc: provider === 'simulation' ? moneyField(formData, 'simulatedBalance') : undefined,
    source_type: sourceTypeForRail(rail),
  });
  revalidatePath(paymentsPath(orgSlug));
}

export async function setAgentPaymentAccessAction(orgId: string, orgSlug: string, formData: FormData): Promise<void> {
  await setAgentPaymentAccess(orgId, requiredStringField(formData, 'agentId'), {
    allowed_rails: railFields(formData),
    budget_usdc: moneyField(formData, 'budget'),
    dedicated_wallet_required: false,
    approval_threshold_usdc: optionalMoneyField(formData, 'approvalThreshold'),
    per_request_cap_usdc: moneyField(formData, 'perRequestCap'),
    status: statusField(formData),
  });
  revalidatePath(paymentsPath(orgSlug));
}

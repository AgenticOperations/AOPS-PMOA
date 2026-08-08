#!/usr/bin/env node
/**
 * AgentOps-governed buyer for arc-nanopayments sellers.
 * Replaces BUYER_PRIVATE_KEY with runtime paymentX402.
 */
import { randomUUID } from 'node:crypto';
import { RuntimeApiClient } from '../../packages/runtime-client/src/index.ts';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const apiBaseUrl = requiredEnv('AGENTOPS_API_BASE_URL');
const credential = requiredEnv('AGENTOPS_AGENT_CREDENTIAL');
const sellerBase = requiredEnv('SELLER_BASE_URL').replace(/\/+$/, '');
const sellerPath = process.env.SELLER_PATH?.trim() || '/api/protected';
const method = (process.env.SELLER_METHOD?.trim().toUpperCase() || 'GET') as
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE';

const url = sellerPath.startsWith('http') ? sellerPath : `${sellerBase}${sellerPath.startsWith('/') ? '' : '/'}${sellerPath}`;

const client = new RuntimeApiClient({
  apiBaseUrl,
  credential,
  timeoutMs: 120_000,
});

const onboard = await client.onboard();
console.log('onboard', JSON.stringify(onboard, null, 2));

const result = await client.paymentX402({
  idempotency_key: `nanopayments-buyer-${randomUUID()}`,
  request: {
    url,
    method,
    headers: [['accept', 'application/json']],
  },
});

console.log('paymentX402', JSON.stringify(result, null, 2));

// S1 [K-17] Reconcile Arc's chain ID.
// Docs say 5042002; the x402 facilitator reportedly returns eip155:14601.
// A wrong chain ID signs against the wrong EIP-712 domain and fails SILENTLY.
const RPC = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';
const FACILITATOR = 'https://gateway-api-testnet.circle.com/v1/x402/supported';

console.log('RPC:', RPC);
try {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
  });
  const j = await r.json();
  console.log('  eth_chainId raw:', JSON.stringify(j));
  if (j.result) console.log('  => decimal:', parseInt(j.result, 16));
} catch (e) {
  console.log('  RPC ERROR:', e.message);
}

console.log('\nFacilitator:', FACILITATOR);
try {
  const r = await fetch(FACILITATOR);
  console.log('  status:', r.status);
  const text = await r.text();
  const nets = [...new Set(text.match(/eip155:\d+/g) ?? [])];
  console.log('  networks advertised:', nets.length ? nets.join(', ') : '(none found)');
  console.log('  body (first 1200 chars):', text.slice(0, 1200));
} catch (e) {
  console.log('  FACILITATOR ERROR:', e.message);
}

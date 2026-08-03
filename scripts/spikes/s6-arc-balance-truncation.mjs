// S6 [C3] Arc ERC-20 balanceOf (6dp, truncating) vs native balance (18dp).
// A balanceOf of 0 does NOT mean zero native balance. Gas decisions must
// read NATIVE. Getting this wrong bricks agents.
const RPC = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';
const USDC = process.env.ARC_USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000';

const rpc = async (method, params) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await r.json()).result;
};

// Sample real accounts from the latest block so we compare live balances.
const blk = await rpc('eth_getBlockByNumber', ['latest', true]);
const addrs = [...new Set((blk?.transactions ?? []).flatMap(t => [t.from, t.to]).filter(Boolean))].slice(0, 6);
console.log('block', parseInt(blk.number, 16), '- sampling', addrs.length, 'addresses\n');

console.log('address                                     native(18dp wei)          erc20 balanceOf(6dp)   native/1e12');
for (const a of addrs) {
  const native = BigInt(await rpc('eth_getBalance', [a, 'latest']));
  const bal = BigInt(await rpc('eth_call', [{ to: USDC, data: '0x70a08231' + a.slice(2).padStart(64, '0') }, 'latest']) || '0x0');
  console.log(a, String(native).padStart(24), String(bal).padStart(22), String(native / 1_000_000_000_000n).padStart(12));
}
console.log('\nIf native/1e12 == erc20 balanceOf, the ERC-20 view is native truncated to 6dp.');

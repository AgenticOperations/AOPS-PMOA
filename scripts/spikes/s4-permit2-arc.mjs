// S4 [K-12] Permit2 against Arc's native-USDC ERC-20 view. GATES LANE 2.
import { createPublicClient, http, parseAbi } from 'viem';

const RPC = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const USDC = process.env.ARC_USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000';
const ZERO = '0x0000000000000000000000000000000000000000';

const client = createPublicClient({ transport: http(RPC) });

console.log('chainId:', await client.getChainId());

const code = await client.getBytecode({ address: PERMIT2 });
console.log('\n[1] Permit2 deployed? bytecode bytes:', code ? (code.length - 2) / 2 : 0);
if (!code || code === '0x') { console.log('  *** PERMIT2 NOT DEPLOYED -> LANE 2 DEAD, TIER T4 ***'); process.exit(0); }

try {
  const d = await client.readContract({
    address: PERMIT2, abi: parseAbi(['function DOMAIN_SEPARATOR() view returns (bytes32)']),
    functionName: 'DOMAIN_SEPARATOR',
  });
  console.log('[2] DOMAIN_SEPARATOR:', d);
} catch (e) { console.log('[2] DOMAIN_SEPARATOR FAILED:', e.shortMessage ?? e.message); }

// The real question: does Permit2's allowance() work against Arc's native-USDC view?
try {
  const a = await client.readContract({
    address: PERMIT2,
    abi: parseAbi(['function allowance(address,address,address) view returns (uint160,uint48,uint48)']),
    functionName: 'allowance', args: [ZERO, USDC, ZERO],
  });
  console.log('[3] allowance(owner,token,spender) ->', a, '(amount, expiration, nonce)');
} catch (e) { console.log('[3] allowance FAILED:', e.shortMessage ?? e.message); }

// Arc USDC ERC-20 surface + the truncation question (S6)
console.log('\n[4] Arc USDC at', USDC);
for (const [fn, sig] of [['decimals','function decimals() view returns (uint8)'],
                          ['symbol','function symbol() view returns (string)'],
                          ['totalSupply','function totalSupply() view returns (uint256)']]) {
  try {
    const v = await client.readContract({ address: USDC, abi: parseAbi([sig]), functionName: fn });
    console.log(`  ${fn}:`, v);
  } catch (e) { console.log(`  ${fn} FAILED:`, e.shortMessage ?? e.message); }
}

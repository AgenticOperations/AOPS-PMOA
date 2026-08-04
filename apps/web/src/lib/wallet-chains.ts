import { defineChain } from 'viem';
import { baseSepolia } from 'viem/chains';

// Arc testnet isn't in viem's registry, so it's defined here. The chain ID
// is the one the x402 facilitator advertises and the RPC reports (spike S1
// -- eip155:5042002, NOT the 14601 an early draft assumed, which is a
// different chain entirely with a different USDC address).
//
// The unusual part: Arc's NATIVE gas asset IS USDC, not a separate coin.
// Wallets assume native != stablecoin, so balances may render with an
// unexpected symbol. Cosmetic only -- signing and sending are unaffected.
export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.network'] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.network' },
  },
  testnet: true,
});

export const supportedChains = [arcTestnet, baseSepolia] as const;

// Canonical Permit2, identical on every EVM chain via CREATE2 -- verified
// live on Arc in spike S4.
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;

export type SupportedChainKey = 'arc' | 'base';

// USDC per chain. Arc's is a precompile-shaped address because USDC is the
// native gas asset there; Base's is an ordinary ERC-20. Keyed by chain key
// rather than chain id so lookups are total -- a numeric index would be
// possibly-undefined at every call site for no real benefit.
export const USDC_ADDRESS: Record<SupportedChainKey, `0x${string}`> = {
  arc: '0x3600000000000000000000000000000000000000',
  base: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

export const CHAIN_ID_BY_KEY: Record<SupportedChainKey, number> = {
  arc: arcTestnet.id,
  base: baseSepolia.id,
};

export function chainKeyFromId(chainId: number): SupportedChainKey | undefined {
  if (chainId === arcTestnet.id) return 'arc';
  if (chainId === baseSepolia.id) return 'base';
  return undefined;
}

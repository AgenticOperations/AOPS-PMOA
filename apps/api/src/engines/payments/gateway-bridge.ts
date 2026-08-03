// Just-in-time Circle Gateway bridge [K-15, K-18]. Replaces the
// `bridgeWalletTopUp` stub Phase 2 deliberately left behind when it flipped
// to developer-controlled wallets. Three calls, no human, no private keys:
// sign a burn intent, POST it to Gateway for attestation, mint on the
// destination chain. Circle's own sample is titled "burns from Arc Testnet
// and mints on Base Sepolia" -- literally this scenario.
//
// Deliberately Circle-SDK-free and dependency-injected (see GatewayBridgeDeps)
// so the burn-intent construction can be unit tested without real network
// calls. circle-provider.ts wires the real Circle wallet API and Gateway
// HTTP calls into these deps.
//
// EIP-712 structure, domain, and testnet contract addresses verified against
// Circle's live Gateway docs (developers.circle.com/gateway/quickstarts/
// unified-balance-evm) on 2026-08-03, cross-checked against this codebase's
// existing CHAIN_CONTRACTS domain/USDC table in circle-provider.ts (they
// match exactly for every chain already wired here).
import { randomBytes } from 'node:crypto';
import { parseUsdcMicros } from './allocations.js';

export type GatewayBridgeChain = 'base' | 'arbitrum' | 'polygon' | 'optimism' | 'avalanche' | 'arc';
export type GatewayBridgeMode = 'test' | 'live';

// Gateway domain IDs + USDC addresses per chain. Duplicated from
// circle-provider.ts's CHAIN_CONTRACTS (test mode) deliberately, to keep
// this module independent of the Circle SDK and independently testable --
// same tradeoff allocations.ts made for parseUsdcMicros. Keep in sync.
const GATEWAY_CHAINS: Record<GatewayBridgeChain, { readonly domain: number; readonly usdc: string }> = {
  arbitrum: { domain: 3, usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' },
  avalanche: { domain: 1, usdc: '0x5425890298aed601595a70AB815c96711a31Bc65' },
  base: { domain: 6, usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
  optimism: { domain: 2, usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7' },
  polygon: { domain: 7, usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582' },
  arc: { domain: 26, usdc: '0x3600000000000000000000000000000000000000' },
};

// Same address on every testnet chain (deterministic deployment) -- matches
// circle-provider.ts's TESTNET_GATEWAY_WALLET exactly.
export const TESTNET_GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';
// Verified from Circle's Arc -> Base Sepolia quickstart sample. Only
// confirmed at this one address; live mode is refused below until a mainnet
// address is independently verified the same way.
export const TESTNET_GATEWAY_MINTER = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function addressToBytes32(address: string): `0x${string}` {
  return `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
}

const TRANSFER_SPEC_TYPES = [
  { name: 'version', type: 'uint32' },
  { name: 'sourceDomain', type: 'uint32' },
  { name: 'destinationDomain', type: 'uint32' },
  { name: 'sourceContract', type: 'bytes32' },
  { name: 'destinationContract', type: 'bytes32' },
  { name: 'sourceToken', type: 'bytes32' },
  { name: 'destinationToken', type: 'bytes32' },
  { name: 'sourceDepositor', type: 'bytes32' },
  { name: 'destinationRecipient', type: 'bytes32' },
  { name: 'sourceSigner', type: 'bytes32' },
  { name: 'destinationCaller', type: 'bytes32' },
  { name: 'value', type: 'uint256' },
  { name: 'salt', type: 'bytes32' },
  { name: 'hookData', type: 'bytes' },
] as const;

const BURN_INTENT_TYPES = [
  { name: 'maxBlockHeight', type: 'uint256' },
  { name: 'maxFee', type: 'uint256' },
  { name: 'spec', type: 'TransferSpec' },
] as const;

// Circle's own quickstart sample authorizes up to MAX_UINT256 here -- the
// real expiry mechanism is the operator's attestation window, not this
// field. Matched exactly rather than guessing a "safer" value for a
// signature payload we can't easily re-verify against the live contract.
const MAX_BLOCK_HEIGHT = ((1n << 256n) - 1n).toString();

function maxFeeMicros(valueMicros: bigint): bigint {
  // Real Gateway transfer fee is 0.005% of the transfer amount
  // (developers.circle.com/gateway/references/fees). maxFee only bounds
  // what the signer authorizes, not what's charged -- set 10x the real
  // rate as headroom, with a floor so tiny transfers still cover Circle's
  // forwarding/gas costs.
  const proportional = (valueMicros * 500n) / 1_000_000n; // 0.05% ceiling
  const floor = 10_000n; // $0.01
  return proportional > floor ? proportional : floor;
}

export type BurnIntentTransferSpec = {
  readonly version: number;
  readonly sourceDomain: number;
  readonly destinationDomain: number;
  readonly sourceContract: `0x${string}`;
  readonly destinationContract: `0x${string}`;
  readonly sourceToken: `0x${string}`;
  readonly destinationToken: `0x${string}`;
  readonly sourceDepositor: `0x${string}`;
  readonly destinationRecipient: `0x${string}`;
  readonly sourceSigner: `0x${string}`;
  readonly destinationCaller: `0x${string}`;
  readonly value: string;
  readonly salt: `0x${string}`;
  readonly hookData: `0x${string}`;
};

export type BurnIntentMessage = {
  readonly maxBlockHeight: string;
  readonly maxFee: string;
  readonly spec: BurnIntentTransferSpec;
};

export type BurnIntentTypedData = {
  readonly domain: { readonly name: 'GatewayWallet'; readonly version: '1' };
  readonly types: {
    readonly TransferSpec: typeof TRANSFER_SPEC_TYPES;
    readonly BurnIntent: typeof BURN_INTENT_TYPES;
  };
  readonly primaryType: 'BurnIntent';
  readonly message: BurnIntentMessage;
};

export type GatewayBridgeInput = {
  readonly amount: string;
  readonly fromAddress: string;
  readonly fromChain: GatewayBridgeChain;
  readonly toAddress: string;
  readonly toChain: GatewayBridgeChain;
  readonly mode: GatewayBridgeMode;
};

export type GatewayBridgeDeps = {
  readonly gatewayBalance: (input: {
    readonly address: string;
    readonly chain: GatewayBridgeChain;
    readonly mode: GatewayBridgeMode;
  }) => Promise<bigint>;
  readonly signTypedData: (typedData: BurnIntentTypedData) => Promise<`0x${string}`>;
  readonly postTransfer: (input: {
    readonly burnIntent: BurnIntentMessage;
    readonly signature: `0x${string}`;
  }) => Promise<{ readonly attestation: `0x${string}`; readonly signature: `0x${string}` }>;
  readonly contractExecution: (input: {
    readonly attestation: `0x${string}`;
    readonly operatorSignature: `0x${string}`;
    readonly toAddress: string;
    readonly toChain: GatewayBridgeChain;
    readonly mode: GatewayBridgeMode;
  }) => Promise<{ readonly txHash: string }>;
};

export type GatewayBridgeResult = {
  readonly amount: string;
  readonly errorReason?: string;
  readonly fromChain: GatewayBridgeChain;
  readonly providerMode: GatewayBridgeMode;
  readonly success: boolean;
  readonly toChain: GatewayBridgeChain;
  readonly transaction?: string;
};

export async function bridgeWalletTopUp(
  input: GatewayBridgeInput,
  deps: GatewayBridgeDeps,
): Promise<GatewayBridgeResult> {
  const { amount, fromAddress, fromChain, mode, toAddress, toChain } = input;

  if (mode !== 'test') {
    // Testnet contract addresses above are independently verified (spike
    // S1 domain data + Circle's live quickstart sample). The mainnet
    // Gateway Minter address is not -- refuse rather than risk routing a
    // real mint through an unverified address. Constraint I.1 also rules
    // Arc mainnet out entirely.
    return {
      amount, fromChain, providerMode: mode, success: false, toChain,
      errorReason: 'gateway_bridge_live_mode_not_verified',
    };
  }

  const valueMicros = parseUsdcMicros(amount);
  const available = await deps.gatewayBalance({ address: fromAddress, chain: fromChain, mode });
  if (available < valueMicros) {
    // A plain ERC-20 transfer to the Gateway contract is not credited --
    // only deposit() is. This is the distinct, clear error the plan
    // requires instead of a confusing downstream signature/mint failure.
    return { amount, fromChain, providerMode: mode, success: false, toChain, errorReason: 'gateway_wallet_not_deposited' };
  }

  const source = GATEWAY_CHAINS[fromChain];
  const destination = GATEWAY_CHAINS[toChain];

  const spec: BurnIntentTransferSpec = {
    version: 1,
    sourceDomain: source.domain,
    destinationDomain: destination.domain,
    sourceContract: addressToBytes32(TESTNET_GATEWAY_WALLET),
    destinationContract: addressToBytes32(TESTNET_GATEWAY_MINTER),
    sourceToken: addressToBytes32(source.usdc),
    destinationToken: addressToBytes32(destination.usdc),
    sourceDepositor: addressToBytes32(fromAddress),
    destinationRecipient: addressToBytes32(toAddress),
    sourceSigner: addressToBytes32(fromAddress),
    destinationCaller: addressToBytes32(ZERO_ADDRESS),
    value: valueMicros.toString(),
    salt: `0x${randomBytes(32).toString('hex')}`,
    hookData: '0x',
  };

  const burnIntent: BurnIntentMessage = {
    maxBlockHeight: MAX_BLOCK_HEIGHT,
    maxFee: maxFeeMicros(valueMicros).toString(),
    spec,
  };

  const typedData: BurnIntentTypedData = {
    domain: { name: 'GatewayWallet', version: '1' },
    types: { TransferSpec: TRANSFER_SPEC_TYPES, BurnIntent: BURN_INTENT_TYPES },
    primaryType: 'BurnIntent',
    message: burnIntent,
  };

  try {
    const signature = await deps.signTypedData(typedData);
    const { attestation, signature: operatorSignature } = await deps.postTransfer({ burnIntent, signature });
    const mint = await deps.contractExecution({ attestation, operatorSignature, toAddress, toChain, mode });
    return { amount, fromChain, providerMode: mode, success: true, toChain, transaction: mint.txHash };
  } catch (error) {
    return {
      amount, fromChain, providerMode: mode, success: false, toChain,
      errorReason: error instanceof Error ? error.message : 'gateway_bridge_failed',
    };
  }
}

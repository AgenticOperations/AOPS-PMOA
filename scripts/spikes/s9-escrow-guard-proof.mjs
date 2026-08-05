// S9 -- proves ON-CHAIN that the deployed ERC-8183 escrow (Arc testnet) blocks
// the exact front-run that succeeded against Arc's stale deployment in S8:
//   S8 provider front-run setBudget: 0x1caff24388f1797ef3631c88f391bdd3bf0f79148abd232289f029c1ac63af9e
//   S8 client fund (overcharged):    0x0907ac70b8b542a780b8f42630da30e5e8a00c9b510c7c7d3ba06db5d2f2e2a2
//
// Local Foundry tests (FrontRunGuard.t.sol) prove the compiled bytecode is correct.
// This script proves the DEPLOYMENT is correct, with real transactions and real
// tx hashes, including the reverted one. Writes: creates a real job and sends a
// real (reverting) fund() tx from the funded throwaway "client" key.
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  toFunctionSelector,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const deployments = JSON.parse(
  readFileSync(join(__dirname, '../../packages/onchain/deployments.json'), 'utf8')
);

const RPC = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';
const { proxy: ESCROW, usdc: USDC, chainId: CHAIN_ID } = deployments['arc-testnet'];

const PROVIDER_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const CLIENT_KEY = process.env.S9_CLIENT_PRIVATE_KEY;
if (!PROVIDER_KEY || !CLIENT_KEY) {
  console.error('Missing DEPLOYER_PRIVATE_KEY / S9_CLIENT_PRIVATE_KEY in env.');
  process.exit(1);
}

const providerAccount = privateKeyToAccount(PROVIDER_KEY);
const clientAccount = privateKeyToAccount(CLIENT_KEY);

const arcChain = {
  id: CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};

const publicClient = createPublicClient({ chain: arcChain, transport: http(RPC) });
const providerWallet = createWalletClient({ account: providerAccount, chain: arcChain, transport: http(RPC) });
const clientWallet = createWalletClient({ account: clientAccount, chain: arcChain, transport: http(RPC) });

const escrowAbi = parseAbi([
  'function createJob(address provider, address evaluator, uint48 expiredAt, string description, address hook, uint256 providerAgentId) returns (uint256)',
  'function setBudget(uint256 jobId, address token, uint256 amount, bytes optParams)',
  'function fund(uint256 jobId, address expectedToken, uint256 expectedBudget, bytes optParams)',
  'error BudgetMismatch()',
]);
const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
]);

const QUOTED = 20_000n; // 0.02 USDC, as in S8
const FRONT_RUN = 40_000n; // 0.04 USDC, as in S8

console.log('chainId:', await publicClient.getChainId());
console.log('escrow proxy:', ESCROW);
console.log('provider (deployer):', providerAccount.address);
console.log('client:', clientAccount.address);

console.log('\n[0] selector reality check on the deployed implementation:');
console.log('  guarded fund(uint256,address,uint256,bytes) ->', toFunctionSelector('fund(uint256,address,uint256,bytes)'));
console.log('  stale   fund(uint256,bytes)                 ->', toFunctionSelector('fund(uint256,bytes)'));

const clientBalanceBefore = await publicClient.readContract({
  address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [clientAccount.address],
});
const escrowBalanceBefore = await publicClient.readContract({
  address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [ESCROW],
});
console.log('\n[1] balances before -- client:', clientBalanceBefore.toString(), 'escrow:', escrowBalanceBefore.toString());

// 1. Client creates the job. evaluator = client (allowed; provider != evaluator required).
const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 86400);
const { request: createReq, result: jobId } = await publicClient.simulateContract({
  account: clientAccount,
  address: ESCROW,
  abi: escrowAbi,
  functionName: 'createJob',
  args: [providerAccount.address, clientAccount.address, expiredAt, 'S9 guard proof', '0x0000000000000000000000000000000000000000', 0n],
});
const createHash = await clientWallet.writeContract(createReq);
await publicClient.waitForTransactionReceipt({ hash: createHash });
console.log('\n[2] createJob tx:', createHash, '-> jobId', jobId.toString());

// 2. Provider quotes 0.02 USDC.
const { request: quoteReq } = await publicClient.simulateContract({
  account: providerAccount, address: ESCROW, abi: escrowAbi,
  functionName: 'setBudget', args: [jobId, USDC, QUOTED, '0x'],
});
const quoteHash = await providerWallet.writeContract(quoteReq);
await publicClient.waitForTransactionReceipt({ hash: quoteHash });
console.log('[3] provider setBudget(QUOTED=20000) tx:', quoteHash);

// 3. Client approves exactly the quoted amount.
const { request: approveReq } = await publicClient.simulateContract({
  account: clientAccount, address: USDC, abi: erc20Abi,
  functionName: 'approve', args: [ESCROW, QUOTED],
});
const approveHash = await clientWallet.writeContract(approveReq);
await publicClient.waitForTransactionReceipt({ hash: approveHash });
console.log('[4] client approve(escrow, 20000) tx:', approveHash);

// 4. Provider front-runs, raising the budget while the job is still Open. This is
// the exact move that succeeded against Arc's stale build in S8.
const { request: frontRunReq } = await publicClient.simulateContract({
  account: providerAccount, address: ESCROW, abi: escrowAbi,
  functionName: 'setBudget', args: [jobId, USDC, FRONT_RUN, '0x'],
});
const frontRunHash = await providerWallet.writeContract(frontRunReq);
await publicClient.waitForTransactionReceipt({ hash: frontRunHash });
console.log('[5] provider FRONT-RUN setBudget(FRONT_RUN=40000) tx:', frontRunHash);

// 5. Client funds believing the price is still QUOTED. On Arc's stale deployment
// this succeeded (S8 tx 0x0907ac70...) and overcharged the client. Here it must
// revert on-chain. Gas is set explicitly so the tx is actually broadcast rather
// than rejected at the eth_estimateGas preflight -- we need the real reverted
// tx hash, not just a local simulation failure.
let fundHash;
let fundReverted = false;
try {
  fundHash = await clientWallet.writeContract({
    address: ESCROW, abi: escrowAbi, functionName: 'fund',
    args: [jobId, USDC, QUOTED, '0x'], gas: 300_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: fundHash });
  fundReverted = receipt.status === 'reverted';
  console.log('\n[6] client fund(jobId, usdc, QUOTED=20000) tx:', fundHash, '-> status:', receipt.status);
} catch (e) {
  console.log('\n[6] client fund() rejected before broadcast:', e.shortMessage ?? e.message);
}

// 6. Verify by reading balances directly from the RPC, independent of the
// script's own control flow -- do not trust the try/catch above alone.
//
// NOTE: on Arc, the gas token and the "USDC" ERC-20 view at the same address
// are the same underlying balance (confirmed in Task 6: cast balance and
// cast call balanceOf on this address track each other 1:1, just at
// different decimal precision). That means the client's balance necessarily
// drops a little from paying gas on createJob/approve/fund, *even though the
// attack was blocked* -- gas cost is not a fund transfer. The decisive check
// is therefore the ESCROW's balance, which must stay exactly 0: if the guard
// had failed open (like Arc's stale build), the escrow would hold QUOTED or
// FRONT_RUN, not zero.
const clientBalanceAfter = await publicClient.readContract({
  address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [clientAccount.address],
});
const escrowBalanceAfter = await publicClient.readContract({
  address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [ESCROW],
});
console.log('\n[7] balances after -- client:', clientBalanceAfter.toString(), 'escrow:', escrowBalanceAfter.toString());
console.log(
  '  client delta:', (clientBalanceAfter - clientBalanceBefore).toString(),
  '(expected: negative, gas only -- Arc\'s gas token and this USDC view share one balance)'
);

const escrowReceivedNothing = escrowBalanceAfter === 0n && escrowBalanceAfter === escrowBalanceBefore;

console.log('\n=== S9 VERDICT ===');
console.log('fund() reverted on-chain:', fundReverted);
console.log('escrow received nothing:', escrowReceivedNothing);
console.log(
  fundReverted && escrowReceivedNothing
    ? 'PASS: the deployed escrow blocks the exact S8 front-run. Compare to S8\'s successful overcharge tx 0x0907ac70b8b542a780b8f42630da30e5e8a00c9b510c7c7d3ba06db5d2f2e2a2, which left funds sitting in the escrow at the raised amount.'
    : 'FAIL: the deployment did not block the front-run -- do not claim S9 closed S8.'
);
if (fundHash) console.log('reverted fund() tx hash:', fundHash);

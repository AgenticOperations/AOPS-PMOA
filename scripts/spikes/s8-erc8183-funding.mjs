// S8 [K-5] ERC-8183 escrow funding mechanics on Arc. GATES Phase 7 · Tasks 2-3 (D2).
//
// Read-only and safe to re-run. Reproduces the deployment/ABI checks from the
// live spike run; the one-time write-path proof (real approve/setBudget/fund/
// submit/complete transactions) is documented with tx hashes in
// docs/spike-results.md's "S8" section rather than replayed here, matching
// the S4 precedent.
import { createPublicClient, http, parseAbi, toFunctionSelector } from 'viem';

const RPC = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';
const ESCROW = '0x0747EEf0706327138c69792bF28Cd525089e4583'; // verified proxy
const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e'; // D3 prep, Phase 8

const client = createPublicClient({ transport: http(RPC) });

console.log('chainId:', await client.getChainId());

// 1. Is the escrow proxy actually deployed?
const code = await client.getBytecode({ address: ESCROW });
console.log('\n[1] escrow bytecode length:', code?.length ?? 0);
if (!code || code === '0x') { console.log('  *** ESCROW NOT DEPLOYED -> D2 DEAD ***'); process.exit(0); }

// 2. Arc's own showcase job (jobId 1) -- the plan's literal probe. This ABI is
// what Arc's tutorials imply, and IT DOES NOT MATCH the deployed contract --
// the decode below is expected to look like garbage. That mismatch is itself
// the finding: never trust a tutorial-sourced ABI for a Draft EIP without
// verifying against real calldata (see docs/spike-results.md S8, question 5).
try {
  const job = await client.readContract({
    address: ESCROW,
    abi: parseAbi(['function jobs(uint256) view returns (address,address,address,uint256,uint8)']),
    functionName: 'jobs',
    args: [1n],
  });
  console.log('\n[2] jobs(1) with tutorial-assumed ABI [client, provider, evaluator, budget, state]:', job);
  console.log('  client === evaluator?', job[0] === job[2]);
  console.log('  (if this looks like garbage -- invalid address, absurd budget, out-of-range state --');
  console.log('   that confirms the tutorial ABI does not match the deployed struct layout.)');
} catch (e) {
  console.log('\n[2] jobs(1) FAILED:', e.shortMessage ?? e.message);
}

// 3. The decisive question: does a two-argument fund(jobId, expectedBudget)
// selector even exist? Compare against the selector actually used by the
// real, successful fund() transaction recorded in spike-results.md.
console.log('\n[3] fund() selector reality check:');
const assumedGuardedSig = 'fund(uint256,uint256)';
const realWorkingSig = 'fund(uint256,bytes)';
console.log(`  plan-assumed guarded form  "${assumedGuardedSig}" -> selector ${toFunctionSelector(assumedGuardedSig)}`);
console.log(`  real deployed working form "${realWorkingSig}" -> selector ${toFunctionSelector(realWorkingSig)}`);
console.log('  Real fund() tx 0x0907ac70b8b542a780b8f42630da30e5e8a00c9b510c7c7d3ba06db5d2f2e2a2');
console.log('  used selector 0xe25ba707 -- matches the REAL form, not the guarded form.');
console.log('  There is no on-chain protection against a budget raised between quote and fund.');

// 4. D3 prep (Phase 8): does the ERC-8004 Identity registry hold code?
const identityCode = await client.getBytecode({ address: IDENTITY_REGISTRY });
console.log('\n[4] ERC-8004 Identity registry bytecode length:', identityCode?.length ?? 0,
  identityCode && identityCode !== '0x' ? '(deployed)' : '(NOT deployed)');

console.log('\n=== S8 VERDICT: FALLBACK. Escrow (D2) does not ship. See docs/spike-results.md for full evidence. ===');

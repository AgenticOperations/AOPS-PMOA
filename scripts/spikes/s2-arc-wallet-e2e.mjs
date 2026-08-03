// S2 [A2] Dev-controlled EOA wallets on ARC-TESTNET. Gates Phases 2 and 3.
import fs from 'node:fs';
import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

const env = Object.fromEntries(fs.readFileSync('apps/api/.env','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^["']|["']$/g,'')];}));

const client = initiateDeveloperControlledWalletsClient({
  apiKey: env.CIRCLE_TEST_API_KEY,
  entitySecret: env.CIRCLE_TEST_ENTITY_SECRET,
});

const set = await client.createWalletSet({ name: `spike-arc-${Date.now()}` });
const walletSetId = set.data?.walletSet?.id;
console.log('walletSet:', walletSetId);

// THE question: does Circle accept 'ARC-TESTNET'?
const res = await client.createWallets({
  walletSetId,
  blockchains: ['ARC-TESTNET'],
  accountType: 'EOA',          // K-16: pin EOA
  count: 2,
});
console.log('\nwallets:', JSON.stringify(res.data?.wallets ?? res.data, null, 2));

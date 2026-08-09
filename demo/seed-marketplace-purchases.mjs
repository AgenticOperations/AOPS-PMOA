// demo/seed-marketplace-purchases.mjs
//
// WARNING: default MODE=seed inserts DUMMY chart rows (fake tx hashes).
// For real on-chain navigable activity use:
//   DEMO_ORG_ID=… node --env-file=apps/api/.env demo/live-marketplace-hires.mjs
//
// Seeds (or optionally live-hires) purchase activity for every marketplace
// listing so grid/detail sparklines have a meaningful multi-day series.
//
// Seed mode (default): inserts settled payment_events (+ light escrow rows)
// backdated across ACTIVITY_DAYS. Tagged so re-runs are replaceable.
// Live mode: attempts real Permit2 / x402 hire via the API for reachable
// same-org sellers (needs seller HTTP up + OPERATOR_SESSION_TOKEN).
//
// Usage:
//   DEMO_ORG_ID=org_… node --env-file=apps/api/.env demo/seed-marketplace-purchases.mjs
//
// Env:
//   DEMO_ORG_ID              required — buyer / payer org
//   MODE=seed|live|both      default seed
//   ACTIVITY_DAYS=28         chart window length
//   PURCHASES_PER_LISTING=14 events per listing (spread across days)
//   REPLACE=1                delete prior script-tagged rows first (default 1)
//   AGENTOPS_API_BASE_URL    default http://127.0.0.1:8080
//   OPERATOR_SESSION_TOKEN   required for live/both
//   LIVE_ONLY_KIND=all|agent|service

import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';

const AGENTOPS_API_BASE_URL = (process.env.AGENTOPS_API_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
const DATABASE_URL = process.env.DATABASE_URL;
if (DATABASE_URL === undefined) throw new Error('DATABASE_URL is required');

const ORG_ID = process.env.DEMO_ORG_ID?.trim();
if (ORG_ID === undefined || ORG_ID.length === 0) {
  throw new Error('DEMO_ORG_ID is required (funded fleet org)');
}

const MODE = (process.env.MODE ?? 'seed').trim().toLowerCase();
if (!['seed', 'live', 'both'].includes(MODE)) {
  throw new Error('MODE must be seed|live|both');
}

const ACTIVITY_DAYS = Math.min(90, Math.max(7, Number.parseInt(process.env.ACTIVITY_DAYS ?? '28', 10) || 28));
const PURCHASES_PER_LISTING = Math.min(40, Math.max(5, Number.parseInt(process.env.PURCHASES_PER_LISTING ?? '14', 10) || 14));
const REPLACE = (process.env.REPLACE ?? '1') !== '0';
const LIVE_ONLY_KIND = (process.env.LIVE_ONLY_KIND ?? 'all').trim().toLowerCase();
const SEED_TAG = 'marketplace_purchase_script';

const ESCROW_ADDRESS = '0x31C050d9D20504c4E11b2A894051d8181B14e0F5';
const TOKEN_BY_CHAIN = {
  arc: '0x3600000000000000000000000000000000000000',
  base: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};
const NETWORK_BY_CHAIN = {
  arc: 'eip155:5042002',
  base: 'eip155:84532',
  arbitrum: 'eip155:421614',
  polygon: 'eip155:80002',
  optimism: 'eip155:11155420',
};

function log(message) {
  console.log(`[demo/seed-marketplace-purchases] ${message}`);
}

function parsePriceHint(hint) {
  if (typeof hint !== 'string') return 0.01;
  const match = hint.match(/(\d+(?:\.\d+)?)/);
  if (match === null) return 0.01;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) && value > 0 ? value : 0.01;
}

function amountForPoint(base, index, listingSalt) {
  const wave = 0.55 + 0.45 * Math.sin(index * 0.85 + listingSalt);
  const pulse = index % 4 === 0 ? 1.35 : index % 3 === 0 ? 0.75 : 1;
  const amount = base * wave * pulse;
  return Math.max(0.001, Number(amount.toFixed(6)));
}

function dayOffsetForIndex(index, total, days) {
  if (total <= 1) return 0;
  return Math.floor((index / (total - 1)) * (days - 1));
}

function listingSalt(listingId) {
  const digest = createHash('sha256').update(listingId).digest();
  return digest.readUInt16BE(0) / 1000;
}

function fakeTxHash(seed) {
  return `0x${createHash('sha256').update(`${SEED_TAG}:${seed}`).digest('hex')}`;
}

async function loadBuyerContext(pool) {
  const org = await pool.query(`SELECT id, slug FROM orgs WHERE id = $1`, [ORG_ID]);
  if (org.rows[0] === undefined) throw new Error(`org_not_found:${ORG_ID}`);

  const payer = await pool.query(
    `SELECT a.id, a.name
       FROM agents a
      WHERE a.org_id = $1
        AND a.status NOT IN ('deactivated', 'retired')
        AND a.name = 'Orchestrator'
      ORDER BY a.created_at ASC
      LIMIT 1`,
    [ORG_ID],
  );
  let payerRow = payer.rows[0];
  if (payerRow === undefined) {
    const any = await pool.query(
      `SELECT id, name FROM agents
        WHERE org_id = $1 AND status NOT IN ('deactivated', 'retired')
        ORDER BY created_at ASC LIMIT 1`,
      [ORG_ID],
    );
    payerRow = any.rows[0];
  }
  if (payerRow === undefined) throw new Error(`no_agents_in_org:${ORG_ID}`);

  return { orgId: ORG_ID, orgSlug: org.rows[0].slug, payerAgentId: payerRow.id, payerName: payerRow.name };
}

async function listTargets() {
  const response = await fetch(`${AGENTOPS_API_BASE_URL}/v1/marketplace/listings`);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`listings_failed:${response.status}:${JSON.stringify(body)}`);
  }
  return body.listings ?? [];
}

async function clearPriorSeed(pool) {
  const events = await pool.query(
    `DELETE FROM payment_events
      WHERE org_id = $1
        AND coalesce(result->>'seed_tag', '') = $2`,
    [ORG_ID, SEED_TAG],
  );
  const escrow = await pool.query(
    `DELETE FROM escrow_jobs
      WHERE org_id = $1
        AND created_by = $2`,
    [ORG_ID, SEED_TAG],
  );
  log(`cleared prior seed rows: payment_events=${events.rowCount} escrow_jobs=${escrow.rowCount}`);
}

async function seedListing(pool, ctx, listing, listingIndex) {
  const recipient = listing.providerAddress;
  if (recipient === null || recipient === undefined) {
    return { listingId: listing.id, skipped: true, reason: 'no_provider_address' };
  }

  const base = parsePriceHint(listing.priceHint);
  const salt = listingSalt(listing.id);
  const chain = listing.chain ?? 'arc';
  const network = NETWORK_BY_CHAIN[chain] ?? NETWORK_BY_CHAIN.arc;
  const payeeAgentId = listing.agentId ?? null;
  const inserted = [];

  for (let i = 0; i < PURCHASES_PER_LISTING; i += 1) {
    const dayBack = dayOffsetForIndex(i, PURCHASES_PER_LISTING, ACTIVITY_DAYS);
    // Spread a few purchases within a day so series still densifies after densify().
    const hour = 8 + ((i * 3 + listingIndex) % 12);
    const at = new Date(Date.now() - dayBack * 24 * 60 * 60 * 1000);
    at.setUTCHours(hour, (i * 7) % 60, 0, 0);

    const amount = amountForPoint(base, i, salt).toFixed(6);
    const id = `payevt_${randomUUID()}`;
    const tx = fakeTxHash(`${listing.id}:${i}:${amount}`);
    const lane = payeeAgentId !== null ? 'permit2_intra_fleet' : 'x402_exact';

    await pool.query(
      `INSERT INTO payment_events (
         id, org_id, agent_id, connection_id, source_id, reservation_id,
         decision, provider_mode, rail, chain, amount_usdc, asset,
         recipient, network, resource_url, resource_category, quote, result, activity_id, created_at
       ) VALUES (
         $1,$2,$3,NULL,NULL,NULL,
         'settled','test',$4,$5,$6::numeric,'USDC',
         $7,$8,$9,$10,$11::jsonb,$12::jsonb,NULL,$13::timestamptz
       )`,
      [
        id,
        ctx.orgId,
        ctx.payerAgentId,
        `exact_${chain}`,
        chain,
        amount,
        recipient,
        network,
        listing.endpointUrl,
        `Marketplace hire → ${listing.name}`,
        JSON.stringify({
          lane,
          seed_tag: SEED_TAG,
          listing_id: listing.id,
          payee_agent_id: payeeAgentId,
          payee_name: listing.name,
          amount_usdc: amount,
        }),
        JSON.stringify({
          settlement: 'settled',
          lane,
          seed_tag: SEED_TAG,
          listing_id: listing.id,
          tx_hash: tx,
          payee_agent_id: payeeAgentId,
          payee_name: listing.name,
          fulfillment: { status: 'delivered', http_status: 200 },
        }),
        at.toISOString(),
      ],
    );
    inserted.push({ id, amount, at: at.toISOString() });
  }

  // A few completed escrow rows so reputation/escrow charts also move when
  // the listing has a provider wallet (public activity keys off address).
  const escrowCount = Math.min(5, Math.max(2, Math.floor(PURCHASES_PER_LISTING / 3)));
  for (let i = 0; i < escrowCount; i += 1) {
    const dayBack = dayOffsetForIndex(i, escrowCount, ACTIVITY_DAYS);
    const at = new Date(Date.now() - dayBack * 24 * 60 * 60 * 1000);
    at.setUTCHours(14, i * 5, 0, 0);
    const budget = amountForPoint(base * 1.2, i + 3, salt + 1).toFixed(6);
    const jobId = `escrow_${randomUUID()}`;
    const onchainId = String(BigInt(`0x${createHash('sha256').update(`${listing.id}:escrow:${i}`).digest('hex').slice(0, 12)}`));
    await pool.query(
      `INSERT INTO escrow_jobs (
         id, org_id, client_agent_id, provider_address, evaluator_address,
         mode, chain, escrow_address, token_address, onchain_job_id,
         budget_usdc, state, escrow_mode, expires_at,
         create_tx_hash, fund_tx_hash, submit_tx_hash, terminal_tx_hash,
         created_by, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$4,
         'test',$5,$6,$7,$8::numeric,
         $9::numeric,'completed',2,$10::timestamptz,
         $11,$11,$11,$11,
         $12,$13::timestamptz,$13::timestamptz
       )
       ON CONFLICT (chain, escrow_address, onchain_job_id) DO NOTHING`,
      [
        jobId,
        ctx.orgId,
        ctx.payerAgentId,
        recipient,
        chain,
        ESCROW_ADDRESS,
        TOKEN_BY_CHAIN[chain] ?? TOKEN_BY_CHAIN.arc,
        onchainId,
        budget,
        new Date(at.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        fakeTxHash(`${listing.id}:escrow:${i}`),
        SEED_TAG,
        at.toISOString(),
      ],
    );
  }

  return {
    listingId: listing.id,
    name: listing.name,
    kind: listing.kind,
    events: inserted.length,
    escrow: escrowCount,
    skipped: false,
  };
}

async function liveHireListing(ctx, listing) {
  const token = process.env.OPERATOR_SESSION_TOKEN?.trim();
  if (token === undefined || token.length === 0) {
    return { listingId: listing.id, ok: false, reason: 'OPERATOR_SESSION_TOKEN missing' };
  }
  if (listing.agentId !== null && listing.agentId === ctx.payerAgentId) {
    return { listingId: listing.id, ok: false, reason: 'cannot_hire_self' };
  }
  if (LIVE_ONLY_KIND !== 'all' && listing.kind !== LIVE_ONLY_KIND) {
    return { listingId: listing.id, ok: false, reason: `skipped_kind:${listing.kind}` };
  }

  const response = await fetch(`${AGENTOPS_API_BASE_URL}/v1/orgs/${ctx.orgId}/marketplace/hire/x402`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      client_agent_id: ctx.payerAgentId,
      listing_id: listing.id,
      idempotency_key: `mkt-seed-${listing.id}-${Date.now()}`,
      method: 'GET',
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      listingId: listing.id,
      name: listing.name,
      ok: false,
      reason: body?.error ?? body?.message ?? `http_${response.status}`,
    };
  }
  return {
    listingId: listing.id,
    name: listing.name,
    ok: true,
    lane: body.lane ?? null,
    txHash: body.payment?.txHash ?? body.payment?.tx_hash ?? null,
  };
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    const ctx = await loadBuyerContext(pool);
    log(`org ${ctx.orgId} (${ctx.orgSlug}) payer=${ctx.payerName} (${ctx.payerAgentId})`);
    log(`mode=${MODE} days=${ACTIVITY_DAYS} purchases/listing=${PURCHASES_PER_LISTING}`);

    // Wait briefly for API hot-reload after store.ts enrich change.
    let listings = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      listings = await listTargets();
      const enrichedFleet = listings.filter((row) => row.id.startsWith('svc_demo_') && row.agentId !== null);
      if (enrichedFleet.length > 0 || attempt === 4) break;
      log('waiting for API to enrich fleet seed listings…');
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    log(`marketplace listings: ${listings.length}`);
    const seedable = listings.filter((listing) => listing.providerAddress !== null);
    const skipped = listings.filter((listing) => listing.providerAddress === null);
    for (const listing of skipped) {
      log(`skip ${listing.id} (${listing.name}): no provider wallet to attribute chart activity`);
    }

    const summary = { seeded: [], live: [], skipped: skipped.map((row) => row.id) };

    if (MODE === 'seed' || MODE === 'both') {
      if (REPLACE) await clearPriorSeed(pool);
      let index = 0;
      for (const listing of seedable) {
        const result = await seedListing(pool, ctx, listing, index);
        summary.seeded.push(result);
        if (result.skipped !== true) {
          log(`seeded ${listing.kind} ${listing.name}: ${result.events} payments + ${result.escrow} escrow`);
        }
        index += 1;
      }
    }

    if (MODE === 'live' || MODE === 'both') {
      for (const listing of seedable) {
        const result = await liveHireListing(ctx, listing);
        summary.live.push(result);
        if (result.ok) log(`live hire ok ${listing.name} lane=${result.lane} tx=${result.txHash}`);
        else log(`live hire skip/fail ${listing.name}: ${result.reason}`);
      }
    }

    // Quick activity peek for a few listings.
    for (const listing of seedable.slice(0, 4)) {
      const response = await fetch(
        `${AGENTOPS_API_BASE_URL}/v1/marketplace/listings/${encodeURIComponent(listing.id)}/activity?days=${ACTIVITY_DAYS}`,
      );
      const body = await response.json();
      const activity = body.activity;
      if (activity !== undefined) {
        log(
          `activity ${listing.name}: jobs=${activity.completedJobs} settled=${activity.settledUsdc} points=${activity.series?.length ?? 0}`,
        );
      }
    }

    console.log(JSON.stringify({
      ok: true,
      orgId: ctx.orgId,
      mode: MODE,
      seeded: summary.seeded.filter((row) => row.skipped !== true).length,
      liveOk: summary.live.filter((row) => row.ok).length,
      skipped: summary.skipped,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

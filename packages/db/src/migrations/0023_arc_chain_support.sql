-- Adds Arc testnet alongside the existing five chains. Purely additive:
-- every existing chain value stays valid.

-- payment_sources.chain (last defined 0010:6-9)
ALTER TABLE payment_sources DROP CONSTRAINT IF EXISTS payment_sources_chain_check;
ALTER TABLE payment_sources
  ADD CONSTRAINT payment_sources_chain_check
  CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc'));

-- org_treasuries.chain (0009:11, last defined 0010:1-4)
ALTER TABLE org_treasuries DROP CONSTRAINT IF EXISTS org_treasuries_chain_check;
ALTER TABLE org_treasuries
  ADD CONSTRAINT org_treasuries_chain_check
  CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc'));

-- NOTE: payment_reservations has NO chain column -- it derives chain via
-- its source_id FK into payment_sources. The plan draft assumed a
-- constraint here; verified against 0009_section_6_8_payment_control.sql
-- and there is nothing to widen on this table.

-- circle_chain_capabilities.chain (0010:44)
ALTER TABLE circle_chain_capabilities DROP CONSTRAINT IF EXISTS circle_chain_capabilities_chain_check;
ALTER TABLE circle_chain_capabilities
  ADD CONSTRAINT circle_chain_capabilities_chain_check
  CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc'));

-- circle_chain_wallets.chain (0010:94)
ALTER TABLE circle_chain_wallets DROP CONSTRAINT IF EXISTS circle_chain_wallets_chain_check;
ALTER TABLE circle_chain_wallets
  ADD CONSTRAINT circle_chain_wallets_chain_check
  CHECK (chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc'));

-- circle_provider_jobs.chain (0010:114, nullable)
ALTER TABLE circle_provider_jobs DROP CONSTRAINT IF EXISTS circle_provider_jobs_chain_check;
ALTER TABLE circle_provider_jobs
  ADD CONSTRAINT circle_provider_jobs_chain_check
  CHECK (chain IS NULL OR chain IN ('base', 'arbitrum', 'polygon', 'optimism', 'avalanche', 'arc'));

-- Rails (0010:11-27)
ALTER TABLE payment_sources DROP CONSTRAINT IF EXISTS payment_sources_rail_check;
ALTER TABLE payment_sources
  ADD CONSTRAINT payment_sources_rail_check
  CHECK (
    rail IN (
      'gateway_base', 'gateway_arbitrum', 'gateway_polygon',
      'gateway_optimism', 'gateway_avalanche', 'gateway_arc',
      'exact_base', 'exact_arbitrum', 'exact_polygon',
      'exact_optimism', 'exact_avalanche', 'exact_arc'
    )
  );

-- Seed Arc capability for TEST MODE ONLY.
-- Constraint I.1: Arc mainnet does not exist. Do not seed a 'live' row.
--
-- Values verified by spike S1 (docs/spike-results.md):
--   chain id (RPC eth_chainId AND facilitator eip155:5042002 agree)
--   circle_blockchain 'ARC-TESTNET' confirmed accepted by spike S2
--     (POST /v1/w3s/developer/wallets, blockchains: ['ARC-TESTNET'])
-- gateway_domain 26 is Arc's CCTP v2 domain, per Circle's published CCTP
-- domain registry (docs/change-manifest.md: "CCTP v2 is live on Arc
-- (domain 26), TokenMessengerV2 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA").
-- Re-verify against Circle's Gateway API directly before Phase 7's bridge
-- work (K-15) actually calls it -- this column is otherwise unused until then.
INSERT INTO circle_chain_capabilities (
  id, mode, chain, circle_blockchain, gateway_domain, wallet_account_type, metadata
)
VALUES (
  'cap_test_arc', 'test', 'arc', 'ARC-TESTNET', 26, 'eoa',
  '{"network":"Arc Testnet","explorer":"https://testnet.arcscan.app"}'
)
ON CONFLICT (mode, chain) DO NOTHING;

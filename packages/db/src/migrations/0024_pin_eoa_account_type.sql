-- Migration 0012 set these DEFAULTs to 'sca' so new rows silently become
-- smart-contract accounts. Gateway rejects non-EOA signatures and
-- Nanopayments is EOA-only, so the failure surfaces at payment time, not
-- creation time -- the confusing failure mode K-16 warns about.
--
-- Reset the DEFAULT only. Do NOT re-tighten the CHECK to EOA-only here:
-- existing 'sca' rows are live data for the Agent Wallet fallback path
-- (A3's env-flag default), and a hard CHECK would fail migration on them.
-- The hard CHECK (account_type = 'eoa') belongs on the new per-agent
-- wallet table created in Phase 3, which has no legacy rows to conflict
-- with.

ALTER TABLE circle_chain_capabilities ALTER COLUMN wallet_account_type SET DEFAULT 'eoa';
ALTER TABLE circle_wallet_sets        ALTER COLUMN account_type        SET DEFAULT 'eoa';
ALTER TABLE circle_chain_wallets      ALTER COLUMN account_type        SET DEFAULT 'eoa';

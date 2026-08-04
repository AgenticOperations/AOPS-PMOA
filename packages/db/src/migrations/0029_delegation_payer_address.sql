-- User-owned payers: a delegation's payer may be the operator's own wallet
-- (MetaMask etc.), not an agent this platform holds keys for. Two changes:
--
--   1. payer_address becomes the authority for "who is paying". Previously
--      the payer's address was looked up from agent_chain_wallets via
--      payer_agent_id at drawdown time, which is impossible for a wallet
--      the platform doesn't control.
--   2. payer_agent_id becomes nullable, and is now only a link back to an
--      agent when the payer IS one. NULL means a user-owned wallet.
--
-- The on-chain Permit2 allowance is still the real authority; these rows
-- remain the control plane's mirror of it.

ALTER TABLE agent_delegations ADD COLUMN payer_address text;

-- Backfill from the wallet each existing delegation was already resolving
-- to at drawdown time, so behavior is unchanged for every current row.
UPDATE agent_delegations d
   SET payer_address = w.address
  FROM agent_chain_wallets w
 WHERE w.agent_id = d.payer_agent_id
   AND w.mode = d.mode
   AND w.chain = d.chain
   AND w.status = 'active';

-- Any row whose agent wallet is gone could never have drawn down anyway
-- (the lookup threw agent_wallet_not_found), so there is nothing to keep.
DELETE FROM agent_delegations WHERE payer_address IS NULL;

ALTER TABLE agent_delegations ALTER COLUMN payer_address SET NOT NULL;
ALTER TABLE agent_delegations ALTER COLUMN payer_agent_id DROP NOT NULL;

-- A delegation is either an agent's or a user's, never ambiguous: when
-- payer_agent_id is set the payer is that agent; when NULL the payer is a
-- user-owned wallet identified only by payer_address.
CREATE INDEX IF NOT EXISTS agent_delegations_payer_address_idx
  ON agent_delegations (org_id, payer_address, chain, status);

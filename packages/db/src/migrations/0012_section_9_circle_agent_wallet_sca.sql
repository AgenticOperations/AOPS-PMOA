ALTER TABLE circle_chain_capabilities DROP CONSTRAINT IF EXISTS circle_chain_capabilities_wallet_account_type_check;
ALTER TABLE circle_chain_capabilities
  ALTER COLUMN wallet_account_type SET DEFAULT 'sca';
ALTER TABLE circle_chain_capabilities
  ADD CONSTRAINT circle_chain_capabilities_wallet_account_type_check
  CHECK (wallet_account_type IN ('eoa', 'sca'));

UPDATE circle_chain_capabilities
   SET wallet_account_type = 'sca',
       metadata = metadata || '{"walletProvider":"circle_agent_wallet"}'::jsonb
 WHERE wallet_account_type = 'eoa';

ALTER TABLE circle_wallet_sets DROP CONSTRAINT IF EXISTS circle_wallet_sets_account_type_check;
ALTER TABLE circle_wallet_sets
  ALTER COLUMN account_type SET DEFAULT 'sca';
ALTER TABLE circle_wallet_sets
  ADD CONSTRAINT circle_wallet_sets_account_type_check
  CHECK (account_type IN ('eoa', 'sca'));

UPDATE circle_wallet_sets
   SET account_type = 'sca',
       metadata = metadata || '{"signer":"circle_agent_wallet_cli"}'::jsonb
 WHERE account_type = 'eoa';

ALTER TABLE circle_chain_wallets DROP CONSTRAINT IF EXISTS circle_chain_wallets_account_type_check;
ALTER TABLE circle_chain_wallets
  ALTER COLUMN account_type SET DEFAULT 'sca';
ALTER TABLE circle_chain_wallets
  ADD CONSTRAINT circle_chain_wallets_account_type_check
  CHECK (account_type IN ('eoa', 'sca'));

UPDATE circle_chain_wallets
   SET account_type = 'sca',
       metadata = metadata || '{"walletProvider":"circle_agent_wallet"}'::jsonb
 WHERE account_type = 'eoa';

UPDATE payment_sources
   SET account_type = 'sca',
       metadata = metadata || '{"walletProvider":"circle_agent_wallet"}'::jsonb
 WHERE provider IN ('circle_gateway', 'circle_wallets')
   AND account_type IN ('eoa', 'virtual');

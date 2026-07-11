ALTER TABLE policy_action_registry
  ADD COLUMN IF NOT EXISTS condition_groups jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(condition_groups) = 'array'),
  ADD COLUMN IF NOT EXISTS binding_target_types jsonb NOT NULL DEFAULT '["org","team","agent"]'::jsonb CHECK (jsonb_typeof(binding_target_types) = 'array');

UPDATE policy_action_registry
   SET condition_groups = '["resource"]'::jsonb,
       binding_target_types = '["org","team","agent"]'::jsonb
 WHERE action_id = 'runtime.http.request';

UPDATE policy_action_registry
   SET condition_groups = '["resource","payment"]'::jsonb,
       binding_target_types = '["org","team","agent"]'::jsonb
 WHERE action_id = 'payment.x402.authorize';

UPDATE policy_action_registry
   SET condition_groups = '["tool"]'::jsonb,
       binding_target_types = '["org","team","agent"]'::jsonb
 WHERE action_id = 'tool.call';

UPDATE policy_action_registry
   SET condition_groups = '[]'::jsonb,
       binding_target_types = '["org","team"]'::jsonb
 WHERE action_id = 'management.agent.create';

UPDATE policy_action_registry
   SET condition_groups = '[]'::jsonb,
       binding_target_types = '["org","team","agent"]'::jsonb
 WHERE action_id IN ('management.agent.activate', 'management.agent.deactivate', 'management.agent.pause', 'management.connection.issue');

UPDATE policy_action_registry
   SET condition_groups = '[]'::jsonb,
       binding_target_types = '["connection"]'::jsonb
 WHERE action_id IN ('management.connection.rotate', 'management.connection.revoke');

UPDATE policy_action_registry
   SET condition_groups = '[]'::jsonb,
       binding_target_types = '["org","team","agent","connection"]'::jsonb
 WHERE action_id IN ('management.policy.activate', 'management.policy.archive', 'management.policy.bind', 'management.policy.create');

ALTER TABLE circle_chain_capabilities
  ADD COLUMN IF NOT EXISTS gateway_settlement_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exact_settlement_verified boolean NOT NULL DEFAULT true;

ALTER TABLE circle_provider_jobs DROP CONSTRAINT IF EXISTS circle_provider_jobs_job_type_check;
ALTER TABLE circle_provider_jobs
  ADD CONSTRAINT circle_provider_jobs_job_type_check
  CHECK (
    job_type IN (
      'wallet_set.create',
      'wallet.create',
      'wallet.faucet',
      'wallet.rebalance',
      'liquidity.prepare',
      'rail.verify',
      'gateway.deposit',
      'gateway.transfer',
      'wallet.balance_sync',
      'webhook.reconcile'
    )
  );

UPDATE circle_chain_capabilities
   SET gateway_settlement_verified = true,
       exact_settlement_verified = true,
       metadata = metadata || '{"gateway_verification":"verified by section 9 Base Gateway x402 smoke","exact_verification":"verified by Circle wallet USDC transfer proof against the local exact verifier"}'::jsonb
 WHERE chain = 'base';

UPDATE circle_chain_capabilities
   SET gateway_settlement_verified = false,
       exact_settlement_verified = true,
       metadata = metadata || '{"gateway_verification":"liquidity can be prepared, but Gateway x402 settlement remains unverified","exact_verification":"verified by Circle wallet USDC transfer proof against the local exact verifier"}'::jsonb
 WHERE chain <> 'base';

ALTER TABLE circle_provider_jobs DROP CONSTRAINT IF EXISTS circle_provider_jobs_job_type_check;
ALTER TABLE circle_provider_jobs
  ADD CONSTRAINT circle_provider_jobs_job_type_check
  CHECK (
    job_type IN (
      'wallet_set.create',
      'wallet.create',
      'wallet.faucet',
      'wallet.rebalance',
      'gateway.deposit',
      'gateway.transfer',
      'wallet.balance_sync',
      'webhook.reconcile'
    )
  );

CREATE INDEX IF NOT EXISTS payment_route_observations_exact_rebalance_idx
  ON payment_route_observations (org_id, supported_rail, outcome, observed_at DESC)
  WHERE supported_rail LIKE 'exact_%';

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
      'gateway.deposit',
      'gateway.transfer',
      'wallet.balance_sync',
      'webhook.reconcile'
    )
  );

CREATE INDEX IF NOT EXISTS circle_provider_jobs_liquidity_prepare_idx
  ON circle_provider_jobs (org_id, mode, status, created_at DESC)
  WHERE job_type = 'liquidity.prepare';

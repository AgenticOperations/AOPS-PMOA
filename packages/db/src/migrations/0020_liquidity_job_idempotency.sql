WITH ranked_open_jobs AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY org_id, mode, metadata ->> 'connection_id', metadata ->> 'payment_quote_hash'
           ORDER BY created_at ASC, id ASC
         ) AS duplicate_rank
    FROM circle_provider_jobs
   WHERE job_type = 'liquidity.prepare'
     AND status IN ('queued', 'submitted')
     AND metadata ->> 'connection_id' IS NOT NULL
     AND metadata ->> 'payment_quote_hash' IS NOT NULL
)
UPDATE circle_provider_jobs AS jobs
   SET status = 'blocked',
       error_code = 'duplicate_liquidity_job',
       metadata = jobs.metadata || jsonb_build_object(
         'deduplicated_at', now(),
         'deduplicated_by', '0020_liquidity_job_idempotency'
       ),
       updated_at = now()
  FROM ranked_open_jobs AS ranked
 WHERE jobs.id = ranked.id
   AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS circle_provider_jobs_open_liquidity_quote_uidx
  ON circle_provider_jobs (
    org_id,
    mode,
    (metadata ->> 'connection_id'),
    (metadata ->> 'payment_quote_hash')
  )
  WHERE job_type = 'liquidity.prepare'
    AND status IN ('queued', 'submitted')
    AND metadata ->> 'connection_id' IS NOT NULL
    AND metadata ->> 'payment_quote_hash' IS NOT NULL;

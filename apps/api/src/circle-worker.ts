import Fastify from 'fastify';
import pg from 'pg';
import { runMigrations } from '@agentops-pmoa/db';
import { readApiEnv } from './config/env.js';
import { createCircleAgentCliExecutor } from './engines/payments/circle-agent-cli.js';
import { createCircleConnectionService } from './engines/payments/circle-connection-service.js';
import { classifyCircleWorkerJob, startCircleLiquidityWorker } from './engines/payments/circle-liquidity-worker.js';
import { createOrgScopedCircleTreasuryProvider } from './engines/payments/circle-org-provider.js';
import { createPostgresCircleConnectionRepository } from './engines/payments/circle-session-store.js';
import {
  deriveCircleWorkerPaidHttpAllowOrigins,
  registerCircleWorkerRoutes,
} from './engines/payments/circle-worker-app.js';
import { withPostgresCircleOrgLock } from './engines/payments/circle-org-lock.js';
import { reconcileCircleProviderJobs, retryLiquidityJob } from './engines/payments/store.js';
import { purgeExpiredX402Results } from './engines/payments/x402-attempt-store.js';

const env = readApiEnv();
const workerToken = env.circleWorkerToken;
if (workerToken.length < 32) throw new Error('CIRCLE_WORKER_TOKEN must contain at least 32 characters.');
if (env.circleProfileMasterKey.length === 0) throw new Error('CIRCLE_PROFILE_MASTER_KEY is required.');

const pool = new pg.Pool({ connectionString: env.databaseUrl });
await runMigrations(pool);
const connectionService = createCircleConnectionService({
  executorFactory: (environment) => createCircleAgentCliExecutor({ environment }),
  masterKeyBase64: env.circleProfileMasterKey,
  repository: createPostgresCircleConnectionRepository(pool),
});
const app = Fastify({ logger: { level: env.logLevel } });
registerCircleWorkerRoutes(app, {
  connectionService,
  paidHttpAllowOrigins: deriveCircleWorkerPaidHttpAllowOrigins(process.env),
  providerFactory: (orgId) => createOrgScopedCircleTreasuryProvider(connectionService, orgId),
  token: workerToken,
  withOrgLock: (orgId, operation) => withPostgresCircleOrgLock(pool, orgId, operation),
});
let stopLiquidityWorker = (): void => undefined;
app.addHook('onClose', async () => {
  stopLiquidityWorker();
  await pool.end();
});

const host = process.env.CIRCLE_WORKER_HOST ?? '127.0.0.1';
const port = Number(process.env.CIRCLE_WORKER_PORT ?? '8090');
try {
  await app.listen({ host, port });
  const pollMs = Math.max(1_000, Number(process.env.CIRCLE_LIQUIDITY_WORKER_POLL_MS ?? '5000'));
  const submittedRetryMs = Math.max(5_000, Number(process.env.CIRCLE_LIQUIDITY_SUBMITTED_RETRY_MS ?? '30000'));
  stopLiquidityWorker = startCircleLiquidityWorker({
    listJobs: async () => {
      const result = await pool.query<{ readonly id: string; readonly org_id: string }>(
        `SELECT id, org_id
           FROM circle_provider_jobs
          WHERE (
              job_type = 'liquidity.prepare'
              AND (
                status = 'queued'
                OR (status = 'submitted' AND updated_at < now() - ($1::text || ' milliseconds')::interval)
              )
            )
             OR (
              job_type IN ('gateway.deposit', 'wallet.rebalance')
              AND (
                (status = 'submitted' AND updated_at < now() - ($1::text || ' milliseconds')::interval)
                OR (
                  status = 'failed'
                  AND (
                    error_code IN ('circle_cli_command_failed', 'circle_provider_job_timeout')
                    OR error_code LIKE 'Command failed: circle bridge transfer%'
                    OR error_code LIKE '%circle_cli_process_timeout%'
                    OR error_code LIKE '%provider_timeout%'
                  )
                )
              )
            )
          ORDER BY created_at ASC
          LIMIT 10`,
        [submittedRetryMs],
      );
      return result.rows.map((row) => ({ id: row.id, orgId: row.org_id }));
    },
    onError: (job, error) => {
      app.log.error({
        error: error instanceof Error ? error.message : 'circle_liquidity_worker_failed',
        jobId: job.id,
        orgId: job.orgId,
      }, 'Circle liquidity worker pass failed');
    },
    processJob: async (job) => withPostgresCircleOrgLock(pool, job.orgId, async () => {
      const current = await pool.query<{ readonly job_type: string; readonly status: string }>(
        `SELECT job_type, status
           FROM circle_provider_jobs
          WHERE id = $1
            AND org_id = $2
          LIMIT 1`,
        [job.id, job.orgId],
      );
      const row = current.rows[0];
      if (row === undefined) return;
      const action = classifyCircleWorkerJob({ jobType: row.job_type, status: row.status });
      const operator = { actorId: 'circle-liquidity-worker', orgId: job.orgId, role: 'operator' as const };
      const provider = createOrgScopedCircleTreasuryProvider(connectionService, job.orgId);
      if (action === 'retry_liquidity') {
        await retryLiquidityJob(pool, operator, job.orgId, job.id, provider);
      } else if (action === 'reconcile_provider') {
        await reconcileCircleProviderJobs(pool, operator, job.orgId, provider);
      }
    }),
    purgeExpiredResults: () => purgeExpiredX402Results(pool),
  }, pollMs);
} catch (error) {
  app.log.error(error);
  await pool.end();
  process.exit(1);
}

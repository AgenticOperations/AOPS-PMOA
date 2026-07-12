import type pg from 'pg';
import { prefixedId } from './ids.js';

type Db = pg.Pool | pg.PoolClient;

export type ProductOnboardingFlow =
  | 'agent_setup'
  | 'payment_access'
  | 'policy_setup'
  | 'runtime_test';

type ProductOnboardingEvidence = {
  readonly agent_setup: boolean;
  readonly payment_access: boolean;
  readonly policy_setup: boolean;
  readonly runtime_test: boolean;
};

export async function completeProductOnboardingFlow(
  db: Db,
  orgId: string,
  flowKey: ProductOnboardingFlow,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.query(
    `INSERT INTO org_onboarding_states (
       id, org_id, flow_key, status, payload, completed_at, created_by_user_id
     )
     VALUES ($1, $2, $3, 'completed', $4::jsonb, now(), NULL)
     ON CONFLICT (org_id, flow_key) DO UPDATE
        SET status = 'completed',
            payload = EXCLUDED.payload,
            completed_at = COALESCE(org_onboarding_states.completed_at, now()),
            updated_at = now()
      WHERE org_onboarding_states.status <> 'completed'
         OR org_onboarding_states.payload ? 'skipped'`,
    [prefixedId('onb'), orgId, flowKey, JSON.stringify(payload)],
  );
}

export async function reconcileProductOnboardingProgress(db: Db, orgId: string): Promise<void> {
  const evidence = await db.query<ProductOnboardingEvidence>(
    `SELECT
       EXISTS (
         SELECT 1
           FROM connections c
           JOIN connection_credentials cc
             ON cc.org_id = c.org_id
            AND cc.connection_id = c.id
            AND cc.status = 'active'
          WHERE c.org_id = $1
            AND c.status = 'active'
       ) AS agent_setup,
       EXISTS (
         SELECT 1
           FROM policy_bindings pb
           JOIN policy_versions pv
             ON pv.org_id = pb.org_id
            AND pv.policy_id = pb.policy_id
            AND pv.version = pb.policy_version
            AND pv.status = 'active'
          WHERE pb.org_id = $1
            AND pb.status = 'active'
       ) AS policy_setup,
       EXISTS (
         SELECT 1
           FROM agent_payment_accounts apa
          WHERE apa.org_id = $1
            AND apa.status = 'active'
            AND apa.payment_access
       ) AS payment_access,
       EXISTS (
         SELECT 1
           FROM activity_items ai
          WHERE ai.org_id = $1
            AND ai.connection_id IS NOT NULL
            AND (
              ai.action LIKE 'runtime.%'
              OR ai.action LIKE 'mcp.%'
              OR ai.action LIKE 'operation.%'
              OR ai.action LIKE 'payment.x402%'
            )
       ) AS runtime_test`,
    [orgId],
  );
  const row = evidence.rows[0];
  if (row === undefined) return;

  const completed = (Object.keys(row) as ProductOnboardingFlow[]).filter((flowKey) => row[flowKey]);
  await Promise.all(completed.map((flowKey) => completeProductOnboardingFlow(db, orgId, flowKey, {
    source: 'reconciled_from_product_state',
  })));
}

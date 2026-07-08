import type pg from 'pg';
import { createApprovalRequest, recordActivity } from '../approvals/store.js';
import { IdentityError } from '../identity/errors.js';
import { authenticateConnection, type ConnectionAuthResult } from '../identity/store.js';
import { checkPolicyDecision } from '../policy/store.js';
import { runtimeActionSchemas, runtimeContractVersion } from './action-contract.js';
import { normalizeRuntimeCheck } from './normalizer.js';
import type { RuntimeCheckInput, RuntimeDecisionResponse, RuntimeOnboardResponse } from './types.js';

type AgentRow = {
  readonly id: string;
  readonly name: string;
};

export async function authenticateRuntimeConnection(pool: pg.Pool, token: string): Promise<ConnectionAuthResult> {
  const auth = await authenticateConnection(pool, token);
  if (auth === null) throw new IdentityError('invalid_connection', 401, 'Connection credential is invalid.');
  return auth;
}

async function getAgent(pool: pg.Pool, auth: ConnectionAuthResult): Promise<AgentRow> {
  const result = await pool.query<AgentRow>('SELECT id, name FROM agents WHERE org_id = $1 AND id = $2', [
    auth.org_id,
    auth.agent_id,
  ]);
  const row = result.rows[0];
  if (row === undefined) throw new IdentityError('not_found', 404, 'Agent was not found.');
  return row;
}

export async function onboardRuntime(pool: pg.Pool, auth: ConnectionAuthResult): Promise<RuntimeOnboardResponse> {
  const agent = await getAgent(pool, auth);
  await recordActivity(pool, {
    orgId: auth.org_id,
    agentId: auth.agent_id,
    connectionId: auth.connection_id,
    category: 'runtime',
    action: 'runtime.onboarded',
    outcome: 'success',
    summary: 'Runtime contract issued',
    payload: { contract_version: runtimeContractVersion },
  });

  return {
    agent: {
      id: agent.id,
      name: agent.name,
    },
    connection: {
      id: auth.connection_id,
    },
    contractVersion: runtimeContractVersion,
    runtime: {
      checkEndpoint: '/v1/runtime/check',
      enforcementMode: {
        runtimeApi: 'advisory_when_called_directly',
        mcp: 'mediated_when_agent_uses_agentops_mcp',
        paymentSigning: 'hard_when_agentops_controls_signing',
      },
    },
    parser: {
      mode: 'deterministic_v1',
      lowConfidenceBehavior: 'needs_more_info',
    },
    actions: runtimeActionSchemas,
  };
}

export async function checkRuntimePolicy(
  pool: pg.Pool,
  auth: ConnectionAuthResult,
  input: RuntimeCheckInput,
): Promise<RuntimeDecisionResponse> {
  const normalized = normalizeRuntimeCheck(input);
  const target = { type: 'agent' as const, id: auth.agent_id };
  if (!normalized.ok) {
    const activity = await recordActivity(pool, {
      orgId: auth.org_id,
      agentId: auth.agent_id,
      connectionId: auth.connection_id,
      category: 'runtime',
      action: 'runtime.check.needs_more_info',
      outcome: 'pending',
      summary: 'Runtime check needs more information',
      payload: {
        action: normalized.action,
        missing_fields: normalized.missingFields,
      },
    });
    return {
      id: null,
      decision: 'needs_more_info',
      reasonCode: normalized.reasonCode,
      explanation: normalized.explanation,
      matched: [],
      approvalId: null,
      missingFields: normalized.missingFields,
      normalized: {
        action: normalized.action,
        target,
        context: { ...normalized.context, activity_id: activity.id },
      },
    };
  }

  const decision = await checkPolicyDecision(
    pool,
    { actorId: auth.connection_id, role: 'member', orgId: auth.org_id },
    auth.org_id,
    {
      actor: { type: 'connection', id: auth.connection_id },
      action: normalized.action,
      target,
      context: normalized.context,
    },
  );

  const approval =
    decision.decision === 'approval_required'
      ? await createApprovalRequest(pool, {
          orgId: auth.org_id,
          agentId: auth.agent_id,
          connectionId: auth.connection_id,
          decisionId: decision.id,
          action: normalized.action,
          target,
          context: normalized.context,
        })
      : null;

  const activity = await recordActivity(pool, {
    orgId: auth.org_id,
    agentId: auth.agent_id,
    connectionId: auth.connection_id,
    decisionId: decision.id,
    approvalId: approval?.id,
    category: 'runtime',
    action: 'runtime.check',
    outcome: decision.decision === 'deny' ? 'denied' : decision.decision === 'approval_required' ? 'pending' : 'success',
    summary: `Runtime check ${decision.decision}`,
    payload: {
      action: normalized.action,
      decision: decision.decision,
    },
  });

  return {
    id: decision.id,
    decision: decision.decision,
    reasonCode: decision.reasonCode,
    explanation: decision.explanation,
    matched: decision.matched,
    approvalId: approval?.id ?? null,
    missingFields: [],
    normalized: {
      action: normalized.action,
      target,
      context: { ...normalized.context, activity_id: activity.id },
    },
  };
}

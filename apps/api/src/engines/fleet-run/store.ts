import type pg from 'pg';
import { prefixedId } from '../identity/ids.js';
import type {
  FleetChecklistItem,
  FleetResolvedAgent,
  FleetRunEvent,
  FleetRunRecord,
  FleetRunStatus,
} from './types.js';

type RunRow = {
  id: string;
  org_id: string;
  goal: string;
  status: FleetRunStatus;
  orchestrator_agent_id: string | null;
  checklist: FleetChecklistItem[];
  agents: Record<string, FleetResolvedAgent>;
  fruit: Record<string, unknown> | null;
  error: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

type EventRow = {
  id: string;
  seq: number;
  kind: string;
  tool: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
};

function mapRun(row: RunRow, events: readonly FleetRunEvent[]): FleetRunRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    goal: row.goal,
    status: row.status,
    orchestratorAgentId: row.orchestrator_agent_id,
    checklist: row.checklist,
    agents: row.agents,
    fruit: row.fruit,
    error: row.error,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    events,
  };
}

function mapEvent(row: EventRow): FleetRunEvent {
  return {
    id: row.id,
    seq: row.seq,
    kind: row.kind,
    tool: row.tool,
    payload: row.payload ?? {},
    createdAt: row.created_at.toISOString(),
  };
}

export async function createFleetRun(
  pool: pg.Pool,
  input: {
    readonly orgId: string;
    readonly goal: string;
    readonly createdBy: string;
    readonly orchestratorAgentId: string;
    readonly checklist: readonly FleetChecklistItem[];
    readonly agents: Readonly<Record<string, FleetResolvedAgent>>;
  },
): Promise<FleetRunRecord> {
  const id = prefixedId('frun');
  await pool.query(
    `INSERT INTO fleet_runs (
       id, org_id, goal, status, orchestrator_agent_id, checklist, agents, created_by
     ) VALUES ($1, $2, $3, 'planned', $4, $5::jsonb, $6::jsonb, $7)`,
    [
      id,
      input.orgId,
      input.goal,
      input.orchestratorAgentId,
      JSON.stringify(input.checklist),
      JSON.stringify(input.agents),
      input.createdBy,
    ],
  );
  return getFleetRun(pool, input.orgId, id);
}

export async function getFleetRun(
  pool: pg.Pool,
  orgId: string,
  runId: string,
): Promise<FleetRunRecord> {
  const run = await pool.query<RunRow>(
    `SELECT * FROM fleet_runs WHERE id = $1 AND org_id = $2`,
    [runId, orgId],
  );
  const row = run.rows[0];
  if (row === undefined) {
    throw Object.assign(new Error('fleet_run_not_found'), { statusCode: 404 });
  }
  const events = await pool.query<EventRow>(
    `SELECT id, seq, kind, tool, payload, created_at
       FROM fleet_run_events
      WHERE run_id = $1
      ORDER BY seq ASC`,
    [runId],
  );
  return mapRun(row, events.rows.map(mapEvent));
}

export async function listFleetRuns(
  pool: pg.Pool,
  orgId: string,
  limit = 20,
): Promise<readonly FleetRunRecord[]> {
  const result = await pool.query<RunRow>(
    `SELECT * FROM fleet_runs WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [orgId, limit],
  );
  return result.rows.map((row) => mapRun(row, []));
}

export async function appendFleetRunEvent(
  pool: pg.Pool,
  input: {
    readonly orgId: string;
    readonly runId: string;
    readonly kind: string;
    readonly tool?: string | null;
    readonly payload?: Record<string, unknown>;
  },
): Promise<FleetRunEvent> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seqResult = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM fleet_run_events WHERE run_id = $1`,
      [input.runId],
    );
    const seq = seqResult.rows[0]?.next ?? 1;
    const id = prefixedId('fre');
    const inserted = await client.query<EventRow>(
      `INSERT INTO fleet_run_events (id, run_id, org_id, seq, kind, tool, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, seq, kind, tool, payload, created_at`,
      [
        id,
        input.runId,
        input.orgId,
        seq,
        input.kind,
        input.tool ?? null,
        JSON.stringify(input.payload ?? {}),
      ],
    );
    await client.query(
      `UPDATE fleet_runs SET updated_at = now() WHERE id = $1 AND org_id = $2`,
      [input.runId, input.orgId],
    );
    await client.query('COMMIT');
    return mapEvent(inserted.rows[0]!);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateFleetRunState(
  pool: pg.Pool,
  input: {
    readonly orgId: string;
    readonly runId: string;
    readonly status?: FleetRunStatus;
    readonly checklist?: readonly FleetChecklistItem[];
    readonly fruit?: Record<string, unknown> | null;
    readonly error?: string | null;
    readonly complete?: boolean;
  },
): Promise<void> {
  await pool.query(
    `UPDATE fleet_runs SET
       status = COALESCE($3, status),
       checklist = COALESCE($4::jsonb, checklist),
       fruit = COALESCE($5::jsonb, fruit),
       error = COALESCE($6, error),
       updated_at = now(),
       completed_at = CASE WHEN $7 THEN now() ELSE completed_at END
     WHERE id = $1 AND org_id = $2`,
    [
      input.runId,
      input.orgId,
      input.status ?? null,
      input.checklist === undefined ? null : JSON.stringify(input.checklist),
      input.fruit === undefined ? null : JSON.stringify(input.fruit),
      input.error === undefined ? null : input.error,
      input.complete === true,
    ],
  );
}

export function markChecklistItem(
  checklist: readonly FleetChecklistItem[],
  id: string,
  status: FleetChecklistItem['status'],
): FleetChecklistItem[] {
  return checklist.map((item) => (item.id === id ? { ...item, status } : item));
}

'use server';

import { createFleetRun, executeFleetRun, getFleetRun, FleetRunApiError } from '@/lib/server/fleet-run-client';
import type { FleetRunRecord } from '@/lib/server/fleet-run-client';

export type FleetRunActionState = {
  readonly ok?: boolean;
  readonly error?: string;
  readonly errorCode?: string | null;
  readonly run?: FleetRunRecord;
};

export async function startFleetRunAction(
  orgId: string,
  _prev: FleetRunActionState,
  formData: FormData,
): Promise<FleetRunActionState> {
  const goal = String(formData.get('goal') ?? '').trim();
  if (goal.length < 8) {
    return { error: 'Describe a goal with a bit more detail (at least a sentence).' };
  }
  try {
    const created = await createFleetRun(orgId, goal);
    const run = await executeFleetRun(orgId, created.id);
    return { ok: true, run };
  } catch (error) {
    if (error instanceof FleetRunApiError) {
      return { error: error.message, errorCode: error.code };
    }
    return { error: error instanceof Error ? error.message : 'Fleet Run failed.' };
  }
}

export async function refreshFleetRunAction(orgId: string, runId: string): Promise<FleetRunActionState> {
  try {
    const run = await getFleetRun(orgId, runId);
    return { ok: true, run };
  } catch (error) {
    if (error instanceof FleetRunApiError) {
      return { error: error.message, errorCode: error.code };
    }
    return { error: error instanceof Error ? error.message : 'Could not refresh Fleet Run.' };
  }
}

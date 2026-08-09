'use server';

import { revalidatePath } from 'next/cache';
import { FLEET_AGENT_NAMES, FLEET_RAILS_BY_NAME, type FleetAgentName } from '@/lib/fleet-readiness';
import { createAgent, listAgents } from '@/lib/server/identity-spine-client';
import { setAgentPaymentAccess } from '@/lib/server/payments-client';

export type EnsureFleetAgentsState = {
  readonly ok?: boolean;
  readonly error?: string;
  readonly created?: readonly string[];
  readonly empowered?: readonly string[];
  readonly message?: string;
};

export async function ensureFleetAgentsAction(
  orgId: string,
  orgSlug: string,
  _prev: EnsureFleetAgentsState,
  _formData: FormData,
): Promise<EnsureFleetAgentsState> {
  try {
    const agents = await listAgents(orgId);
    const active = agents.filter((agent) => agent.status !== 'deactivated' && agent.status !== 'retired');
    const byName = new Map(active.map((agent) => [agent.name, agent]));

    const created: string[] = [];
    for (const name of FLEET_AGENT_NAMES) {
      if (byName.has(name)) continue;
      const agent = await createAgent(orgId, {
        name,
        description: `Fleet Run specialist (${name})`,
        labels: ['fleet', 'fleet-run'],
        metadata: { setup_mode: 'publish', fleet_role: name },
      });
      byName.set(name, agent);
      created.push(name);
    }

    const empowered: string[] = [];
    for (const name of FLEET_AGENT_NAMES) {
      const agent = byName.get(name);
      if (agent === undefined) continue;
      const rails = FLEET_RAILS_BY_NAME[name as FleetAgentName];
      await setAgentPaymentAccess(orgId, agent.id, {
        allowed_rails: rails,
        budget_usdc: name === 'Orchestrator' ? '10.00' : '5.00',
        dedicated_wallet_required: true,
        per_request_cap_usdc: '2.00',
        status: 'active',
      });
      empowered.push(name);
    }

    revalidatePath('/chat');
    revalidatePath(`/app/${orgSlug}/fleet-run`);
    revalidatePath(`/app/${orgSlug}/agents`);
    revalidatePath(`/app/${orgSlug}/payments/empower`);

    const waitNote =
      'Wallets provision via the Circle worker — open Empower, wait until wallets show active, then return here.';
    if (created.length === 0) {
      return {
        ok: true,
        created,
        empowered,
        message: `Fleet agents already present. Re-enabled payment access for ${empowered.join(', ')}. ${waitNote}`,
      };
    }
    return {
      ok: true,
      created,
      empowered,
      message: `Created ${created.join(', ')}. ${waitNote}`,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not create fleet agents.',
    };
  }
}

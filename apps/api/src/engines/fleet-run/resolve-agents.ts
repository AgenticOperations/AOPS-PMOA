import type pg from 'pg';
import { IdentityError } from '../identity/errors.js';
import { seedMarketplaceServices } from '../marketplace/seed-catalog.js';
import type { FleetResolvedAgent } from './types.js';

type AgentRow = {
  id: string;
  name: string;
  metadata: Record<string, unknown> | null;
};

const ROLE_BY_NAME: Readonly<Record<string, FleetResolvedAgent['role']>> = {
  Orchestrator: 'orchestrator',
  DataFetcher: 'data_fetcher',
  Analyst: 'analyst',
  Writer: 'writer',
  SeniorReviewer: 'senior_reviewer',
};

const CHAIN_BY_ROLE: Readonly<Record<FleetResolvedAgent['role'], 'arc' | 'base'>> = {
  orchestrator: 'arc',
  data_fetcher: 'arc',
  analyst: 'arc',
  writer: 'arc',
  senior_reviewer: 'base',
};

function seedUrlForName(name: string): string | null {
  if (name === 'Orchestrator') return 'http://127.0.0.1/orchestrator';
  const seed = seedMarketplaceServices().find((service) => service.name === name);
  if (seed === undefined) return null;
  if (name === 'DataFetcher') return `${seed.endpointUrl.replace(/\/+$/, '')}?q=fleet-run`;
  if (name === 'Analyst') return `${seed.endpointUrl.replace(/\/+$/, '')}?q=fleet-run`;
  if (name === 'Writer') return `${seed.endpointUrl.replace(/\/+$/, '')}?topic=fleet-run`;
  if (name === 'SeniorReviewer') return `${seed.endpointUrl.replace(/\/+$/, '')}?title=fleet-run`;
  return seed.endpointUrl;
}

/**
 * Resolve the change-manifest five-agent fleet from the org roster.
 * Endpoint URLs prefer agent metadata.public_endpoint_url, else demo seed ports.
 */
export async function resolveFleetAgents(
  pool: pg.Pool,
  orgId: string,
): Promise<Readonly<Record<string, FleetResolvedAgent>>> {
  const result = await pool.query<AgentRow>(
    `SELECT DISTINCT ON (a.name) a.id, a.name, a.metadata
       FROM agents a
       INNER JOIN agent_chain_wallets w
         ON w.agent_id = a.id AND w.status = 'active'
      WHERE a.org_id = $1
        AND a.status NOT IN ('deactivated', 'retired')
        AND a.name = ANY($2::text[])
      ORDER BY a.name, a.created_at DESC`,
    [orgId, Object.keys(ROLE_BY_NAME)],
  );

  const byName = new Map(result.rows.map((row) => [row.name, row]));
  const missing = Object.keys(ROLE_BY_NAME).filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new IdentityError(
      'fleet_agents_missing',
      409,
      `Org is missing fleet agents: ${missing.join(', ')}. Create them (or reuse DEMO_ORG_ID reset) before Fleet Run.`,
    );
  }

  const agents: Record<string, FleetResolvedAgent> = {};
  for (const [name, role] of Object.entries(ROLE_BY_NAME)) {
    const row = byName.get(name)!;
    const metaUrl =
      typeof row.metadata?.public_endpoint_url === 'string'
        ? row.metadata.public_endpoint_url.trim()
        : '';
    const endpointUrl = metaUrl.length > 0 ? metaUrl : seedUrlForName(name);
    if (endpointUrl === null || endpointUrl.length === 0) {
      throw new IdentityError(
        'fleet_endpoint_missing',
        409,
        `${name} has no public endpoint. Publish a URL or start demo sellers on ports 4001–4004.`,
      );
    }
    agents[role] = {
      agentId: row.id,
      name,
      role,
      chain: CHAIN_BY_ROLE[role],
      endpointUrl,
    };
  }
  return agents;
}

export async function probeEndpoint(url: string, timeoutMs = 2500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    // 402 Payment Required means the seller is alive and gated — success for wiring.
    return response.status === 402 || response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

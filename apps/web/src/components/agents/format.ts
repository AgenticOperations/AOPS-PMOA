import type { AgentStatus, ConnectionHealth } from '@/lib/identity-spine-types';

export function formatStatus(status: AgentStatus | string): string {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatConnectionHealth(health: ConnectionHealth): string {
  switch (health) {
    case 'not_connected':
      return 'Not connected';
    case 'healthy':
      return 'Healthy';
    case 'stale':
      return 'Stale';
    case 'revoked':
      return 'Revoked';
  }
}

export function formatConnectionKind(kind: string): string {
  switch (kind) {
    case 'agent_credential':
      return 'Agent credential';
    case 'mcp_http':
      return 'Remote connection';
    case 'mcp_local':
      return 'Local connection';
    case 'mcp_remote':
      return 'Remote connection';
    case 'api_key':
      return 'API key';
    case 'manual_observe':
      return 'Observe only';
    default:
      return kind.replaceAll('_', ' ');
  }
}

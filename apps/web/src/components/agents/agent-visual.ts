/**
 * Shared robot mark for agent identity — same asset as Casper home fleet cards.
 * Each agent gets a stable accent tint so the fleet reads as distinct agents,
 * not one generic icon repeated.
 */

export const AGENT_ROBOT_SRC = '/images/robot.png';

export const AGENT_TINTS = [
  { color: '#818cf8', glow: 'rgba(129,140,248,0.28)', soft: 'rgba(129,140,248,0.12)' },
  { color: '#34d399', glow: 'rgba(52,211,153,0.28)', soft: 'rgba(52,211,153,0.12)' },
  { color: '#fbbf24', glow: 'rgba(251,191,36,0.28)', soft: 'rgba(251,191,36,0.14)' },
  { color: '#e879f9', glow: 'rgba(232,121,249,0.28)', soft: 'rgba(232,121,249,0.12)' },
  { color: '#38bdf8', glow: 'rgba(56,189,248,0.28)', soft: 'rgba(56,189,248,0.12)' },
] as const;

export type AgentTint = (typeof AGENT_TINTS)[number];

/** Stable tint index from an agent id (or any seed). */
export function agentTintIndex(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash % AGENT_TINTS.length;
}

export function agentTint(seed: string): AgentTint {
  return AGENT_TINTS[agentTintIndex(seed)] ?? AGENT_TINTS[0]!;
}

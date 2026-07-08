import type { Role } from './types.js';

export const ROLE_RANK: Readonly<Record<Role, number>> = {
  viewer: 0,
  auditor: 1,
  member: 1,
  operator: 2,
  admin: 3,
  owner: 4,
};

export function satisfiesRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

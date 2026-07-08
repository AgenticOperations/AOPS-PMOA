import { randomUUID } from 'node:crypto';

export function prefixedId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function slugifyName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.length > 0 ? slug : 'org';
}

import { createHash } from 'node:crypto';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function encodeCanonical(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new Error('unsupported_audit_value');
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new Error('unsupported_audit_value');
    case 'object':
      break;
  }

  if (value instanceof Date) return JSON.stringify(value.toISOString());

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('unsupported_audit_value');
    seen.add(value);
    const encoded = `[${value.map((item) => encodeCanonical(item, seen)).join(',')}]`;
    seen.delete(value);
    return encoded;
  }

  if (!isPlainObject(value)) throw new Error('unsupported_audit_value');
  if (seen.has(value)) throw new Error('unsupported_audit_value');

  seen.add(value);
  const encodedEntries = Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${encodeCanonical(value[key], seen)}`);
  seen.delete(value);

  return `{${encodedEntries.join(',')}}`;
}

export function canonicalJson(value: JsonValue | Date): string;
export function canonicalJson(value: unknown): string;
export function canonicalJson(value: unknown): string {
  return encodeCanonical(value, new WeakSet<object>());
}

export function sha256Hex(value: JsonValue | Date | string): string;
export function sha256Hex(value: unknown): string;
export function sha256Hex(value: unknown): string {
  const body = typeof value === 'string' ? value : canonicalJson(value);
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

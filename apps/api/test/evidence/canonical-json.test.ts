import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../../src/engines/evidence/canonical-json.js';

describe('canonicalJson', () => {
  it('serializes objects deterministically regardless of key insertion order', () => {
    const left = {
      z: 1,
      a: { c: true, b: ['two', { y: 2, x: 1 }] },
      n: null,
    };
    const right = {
      n: null,
      a: { b: ['two', { x: 1, y: 2 }], c: true },
      z: 1,
    };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(canonicalJson(left)).toBe(
      '{"a":{"b":["two",{"x":1,"y":2}],"c":true},"n":null,"z":1}',
    );
  });

  it('hashes the canonical representation instead of insertion-order JSON', () => {
    const first = sha256Hex({ b: 2, a: 1 });
    const second = sha256Hex({ a: 1, b: 2 });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects unsupported values instead of silently dropping them', () => {
    expect(() => canonicalJson({ unsafe: undefined })).toThrow('unsupported_audit_value');
    expect(() => canonicalJson({ unsafe: () => 'nope' })).toThrow('unsupported_audit_value');
  });
});

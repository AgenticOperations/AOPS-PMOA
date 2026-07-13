import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createX402ResultCryptoCodec,
  validateX402ResultEnvelope,
  validateX402ResultKeyBase64,
} from '../../src/engines/payments/x402-result-crypto.js';
import type { PaidHttpResponse } from '../../src/engines/payments/x402-http.js';

const CONTEXT = {
  attemptId: 'rpa_crypto_test',
  connectionId: 'conn_crypto_test',
  orgId: 'org_crypto_test',
} as const;

function paidResponse(): PaidHttpResponse {
  return {
    body: { apiKey: 'merchant-secret', ok: true },
    bodyEncoding: 'json',
    contentType: 'application/json',
    headers: [['x-merchant-secret', 'never-plaintext']],
    sizeBytes: 42,
    status: 200,
    truncated: false,
  };
}

describe('x402 result crypto', () => {
  it('accepts only canonical base64 keys that decode to exactly 32 bytes', () => {
    const valid = randomBytes(32).toString('base64');
    expect(() => validateX402ResultKeyBase64(valid)).not.toThrow();

    for (const invalid of [
      Buffer.alloc(31).toString('base64'),
      Buffer.alloc(33).toString('base64'),
      Buffer.alloc(32, 255).toString('base64url'),
      `${valid}\n`,
      '!!!!',
    ]) {
      expect(() => validateX402ResultKeyBase64(invalid)).toThrow(
        'x402_result_key_must_be_32_byte_base64',
      );
    }
  });

  it('round-trips an authenticated PaidHttpResponse in an exact AES-256-GCM envelope', () => {
    const codec = createX402ResultCryptoCodec(randomBytes(32).toString('base64'));
    const plaintext = paidResponse();
    const encrypted = codec.encrypt(CONTEXT, plaintext);

    expect(encrypted).toMatchObject({ algorithm: 'aes-256-gcm', version: 1 });
    expect(Object.keys(encrypted).sort()).toEqual([
      'algorithm',
      'ciphertext',
      'iv',
      'tag',
      'version',
    ]);
    expect(Buffer.from(encrypted.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(encrypted.tag, 'base64')).toHaveLength(16);
    expect(Buffer.from(encrypted.ciphertext, 'base64').length).toBeGreaterThan(0);
    expect(JSON.stringify(encrypted)).not.toContain('merchant-secret');
    expect(validateX402ResultEnvelope(encrypted)).toEqual(encrypted);
    expect(codec.decrypt(CONTEXT, encrypted)).toEqual(plaintext);
  });

  it('rejects plaintext, malformed envelopes, and non-canonical base64 fields', () => {
    const codec = createX402ResultCryptoCodec(randomBytes(32).toString('base64'));
    const encrypted = codec.encrypt(CONTEXT, paidResponse());
    const invalid: readonly unknown[] = [
      paidResponse(),
      { ...encrypted, extra: 'field' },
      { ...encrypted, version: 2 },
      { ...encrypted, algorithm: 'aes-128-gcm' },
      { ...encrypted, iv: randomBytes(11).toString('base64') },
      { ...encrypted, tag: randomBytes(15).toString('base64') },
      { ...encrypted, ciphertext: '' },
      { ...encrypted, ciphertext: `${encrypted.ciphertext}\n` },
    ];

    for (const value of invalid) {
      expect(() => validateX402ResultEnvelope(value)).toThrow(
        'x402_result_envelope_invalid',
      );
    }
  });

  it('rejects tampering and ciphertext opened under another tenant, attempt, or key', () => {
    const key = randomBytes(32).toString('base64');
    const codec = createX402ResultCryptoCodec(key);
    const encrypted = codec.encrypt(CONTEXT, paidResponse());
    const tampered = {
      ...encrypted,
      tag: randomBytes(16).toString('base64'),
    };

    expect(() => codec.decrypt(CONTEXT, tampered)).toThrow('x402_result_decryption_failed');
    expect(() => codec.decrypt({ ...CONTEXT, orgId: 'org_other' }, encrypted)).toThrow(
      'x402_result_decryption_failed',
    );
    expect(() => codec.decrypt({ ...CONTEXT, connectionId: 'conn_other' }, encrypted)).toThrow(
      'x402_result_decryption_failed',
    );
    expect(() => codec.decrypt({ ...CONTEXT, attemptId: 'rpa_other' }, encrypted)).toThrow(
      'x402_result_decryption_failed',
    );
    expect(() => createX402ResultCryptoCodec(randomBytes(32).toString('base64'))
      .decrypt(CONTEXT, encrypted)).toThrow('x402_result_decryption_failed');
  });
});

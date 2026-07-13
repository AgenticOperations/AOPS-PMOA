import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { PaidHttpResponse } from './x402-http.js';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type X402ResultCryptoContext = {
  readonly attemptId: string;
  readonly connectionId: string;
  readonly orgId: string;
};

export type X402ResultEnvelope = {
  readonly algorithm: typeof ALGORITHM;
  readonly ciphertext: string;
  readonly iv: string;
  readonly tag: string;
  readonly version: typeof VERSION;
};

export type X402ResultCryptoCodec = {
  readonly decrypt: (
    context: X402ResultCryptoContext,
    encrypted: X402ResultEnvelope,
  ) => PaidHttpResponse;
  readonly encrypt: (
    context: X402ResultCryptoContext,
    value: PaidHttpResponse,
  ) => X402ResultEnvelope;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function decodeCanonicalBase64(
  value: unknown,
  expectedBytes: number | null,
  allowEmpty: boolean,
  errorCode: string,
): Buffer {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new Error(errorCode);
  }
  const decoded = Buffer.from(value, 'base64');
  if (
    decoded.toString('base64') !== value ||
    (expectedBytes !== null && decoded.length !== expectedBytes)
  ) {
    throw new Error(errorCode);
  }
  return decoded;
}

function resultKey(keyBase64: string): Buffer {
  return decodeCanonicalBase64(
    keyBase64,
    KEY_BYTES,
    false,
    'x402_result_key_must_be_32_byte_base64',
  );
}

export function validateX402ResultKeyBase64(keyBase64: string): void {
  resultKey(keyBase64);
}

export function validateX402ResultEnvelope(value: unknown): X402ResultEnvelope {
  if (!isObject(value)) throw new Error('x402_result_envelope_invalid');
  const keys = Object.keys(value).sort();
  const expectedKeys = ['algorithm', 'ciphertext', 'iv', 'tag', 'version'];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    value.algorithm !== ALGORITHM ||
    value.version !== VERSION
  ) {
    throw new Error('x402_result_envelope_invalid');
  }

  decodeCanonicalBase64(
    value.ciphertext,
    null,
    false,
    'x402_result_envelope_invalid',
  );
  decodeCanonicalBase64(
    value.iv,
    IV_BYTES,
    false,
    'x402_result_envelope_invalid',
  );
  decodeCanonicalBase64(
    value.tag,
    TAG_BYTES,
    false,
    'x402_result_envelope_invalid',
  );

  return {
    algorithm: ALGORITHM,
    ciphertext: value.ciphertext as string,
    iv: value.iv as string,
    tag: value.tag as string,
    version: VERSION,
  };
}

function aad(context: X402ResultCryptoContext): Buffer {
  return Buffer.from(JSON.stringify({
    attemptId: context.attemptId,
    connectionId: context.connectionId,
    orgId: context.orgId,
    version: VERSION,
  }), 'utf8');
}

export function createX402ResultCryptoCodec(keyBase64: string): X402ResultCryptoCodec {
  const key = resultKey(keyBase64);

  return {
    decrypt: (context, input) => {
      try {
        const encrypted = validateX402ResultEnvelope(input);
        const decipher = createDecipheriv(
          ALGORITHM,
          key,
          Buffer.from(encrypted.iv, 'base64'),
        );
        decipher.setAAD(aad(context));
        decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
          decipher.final(),
        ]).toString('utf8');
        return JSON.parse(plaintext) as PaidHttpResponse;
      } catch {
        throw new Error('x402_result_decryption_failed');
      }
    },

    encrypt: (context, value) => {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      cipher.setAAD(aad(context));
      const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return validateX402ResultEnvelope({
        algorithm: ALGORITHM,
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        version: VERSION,
      });
    },
  };
}

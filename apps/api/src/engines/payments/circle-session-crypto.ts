import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const MASTER_KEY_BYTES = 32;

export type CircleSessionMode = 'test';

export type CircleSessionCiphertext = {
  readonly algorithm: typeof ALGORITHM;
  readonly ciphertext: string;
  readonly iv: string;
  readonly mode: CircleSessionMode;
  readonly revision: number;
  readonly tag: string;
};

type CircleSessionContext = {
  readonly orgId: string;
  readonly revision: number;
};

type EncryptJsonOptions<T> = CircleSessionContext & {
  readonly masterKeyBase64: string;
  readonly value: T;
};

type DecryptJsonOptions = CircleSessionContext & {
  readonly encrypted: CircleSessionCiphertext;
  readonly masterKeyBase64: string;
};

export function encryptCircleSessionJson<T>({
  masterKeyBase64,
  orgId,
  revision,
  value,
}: EncryptJsonOptions<T>): CircleSessionCiphertext {
  const key = decodeMasterKey(masterKeyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(circleSessionAad({ orgId, revision }));

  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    algorithm: ALGORITHM,
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    mode: 'test',
    revision,
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptCircleSessionJson<T>({
  encrypted,
  masterKeyBase64,
  orgId,
  revision,
}: DecryptJsonOptions): T {
  const key = decodeMasterKey(masterKeyBase64);

  try {
    if (encrypted.algorithm !== ALGORITHM || encrypted.mode !== 'test' || encrypted.revision !== revision) {
      throw new Error('circle_session_envelope_mismatch');
    }

    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.iv, 'base64'));
    decipher.setAAD(circleSessionAad({ orgId, revision }));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');

    return JSON.parse(plaintext) as T;
  } catch {
    throw new Error('circle_session_decryption_failed');
  }
}

function decodeMasterKey(masterKeyBase64: string): Buffer {
  const key = Buffer.from(masterKeyBase64, 'base64');
  if (key.length !== MASTER_KEY_BYTES) {
    throw new Error('circle_session_master_key_must_be_32_bytes');
  }
  return key;
}

function circleSessionAad({ orgId, revision }: CircleSessionContext): Buffer {
  return Buffer.from(JSON.stringify({ mode: 'test', orgId, revision }), 'utf8');
}

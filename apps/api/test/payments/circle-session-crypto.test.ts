import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  decryptCircleSessionJson,
  encryptCircleSessionJson,
} from '../../src/engines/payments/circle-session-crypto.js';

function masterKey(): string {
  return randomBytes(32).toString('base64');
}

describe('Circle session crypto', () => {
  it('encrypts serializable profile fields with test-mode org and revision AAD', () => {
    const key = masterKey();
    const profile = {
      circleEmail: 'ops-owner@example.com',
      organizationId: 'circle_org_test_123',
      phoneLast4: '0187',
    };

    const encrypted = encryptCircleSessionJson({
      masterKeyBase64: key,
      orgId: 'org_abc',
      revision: 7,
      value: profile,
    });

    expect(encrypted).toMatchObject({
      algorithm: 'aes-256-gcm',
      mode: 'test',
      revision: 7,
    });
    expect(typeof encrypted.ciphertext).toBe('string');
    expect(typeof encrypted.iv).toBe('string');
    expect(typeof encrypted.tag).toBe('string');
    expect(JSON.stringify(encrypted)).not.toContain(profile.circleEmail);

    expect(
      decryptCircleSessionJson<typeof profile>({
        encrypted,
        masterKeyBase64: key,
        orgId: 'org_abc',
        revision: 7,
      }),
    ).toEqual(profile);
  });

  it('rejects ciphertext opened for a different org, revision, or key', () => {
    const key = masterKey();
    const encrypted = encryptCircleSessionJson({
      masterKeyBase64: key,
      orgId: 'org_original',
      revision: 2,
      value: { requestId: 'req_secret_123', email: 'owner@example.com' },
    });

    expect(() =>
      decryptCircleSessionJson({
        encrypted,
        masterKeyBase64: key,
        orgId: 'org_other',
        revision: 2,
      }),
    ).toThrow('circle_session_decryption_failed');

    expect(() =>
      decryptCircleSessionJson({
        encrypted,
        masterKeyBase64: key,
        orgId: 'org_original',
        revision: 3,
      }),
    ).toThrow('circle_session_decryption_failed');

    expect(() =>
      decryptCircleSessionJson({
        encrypted,
        masterKeyBase64: masterKey(),
        orgId: 'org_original',
        revision: 2,
      }),
    ).toThrow('circle_session_decryption_failed');
  });

  it('requires a 32-byte base64 master key', () => {
    expect(() =>
      encryptCircleSessionJson({
        masterKeyBase64: Buffer.from('short-key').toString('base64'),
        orgId: 'org_abc',
        revision: 1,
        value: { email: 'owner@example.com' },
      }),
    ).toThrow('circle_session_master_key_must_be_32_bytes');
  });
});

describe('Circle org connection migration', () => {
  const migrationPath = new URL(
    '../../../../packages/db/src/migrations/0018_circle_org_connections.sql',
    import.meta.url,
  );

  it('creates test-only org connection and challenge tables without storing OTP values', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    const challengeTable = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS circle_connection_challenges'));

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS circle_org_connections');
    expect(sql).toMatch(/UPDATE org_payment_modes\s+SET mode = 'test'/);
    expect(sql).toContain("CHECK (mode = 'test')");
    expect(sql).toContain('org_id text NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT');
    expect(sql).toContain("mode text NOT NULL DEFAULT 'test' CHECK (mode = 'test')");
    expect(sql).toContain('UNIQUE (org_id, mode)');
    expect(sql).toContain(
      "status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'otp_pending', 'connected', 'expired', 'blocked'))",
    );
    expect(sql).toContain('profile_ciphertext text NOT NULL');
    expect(sql).toContain('profile_iv text NOT NULL');
    expect(sql).toContain('profile_tag text NOT NULL');
    expect(sql).toContain('revision integer NOT NULL DEFAULT 1 CHECK (revision > 0)');
    expect(sql).toContain('expires_at timestamptz');
    expect(sql).toContain('verified_at timestamptz');
    expect(sql).toContain("WHERE mode = 'test'");
    expect(sql).toContain("status IN ('otp_pending', 'connected')");

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS circle_connection_challenges');
    expect(sql).toContain('user_id text NOT NULL REFERENCES users (id) ON DELETE RESTRICT');
    expect(sql).toContain('request_bundle_ciphertext text NOT NULL');
    expect(sql).toContain('attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)');
    expect(sql).toContain('expires_at timestamptz NOT NULL');
    expect(sql).toContain(
      "status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'expired', 'failed', 'blocked'))",
    );
    expect(challengeTable.toLowerCase()).not.toContain('otp');
  });
});

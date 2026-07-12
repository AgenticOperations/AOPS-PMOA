import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mergeNonEmptyDefaults, parseEnv, setEnvValue, validateRuntimeConfig } from './env-file.mjs';

function validConfig() {
  return {
    api: parseEnv([
      'PORT=8080',
      'DATABASE_URL=postgres://agentops:agentops@localhost:5432/agentops',
      'REDIS_URL=redis://localhost:6379',
      'APP_BASE_URL=http://localhost:3005',
      'SESSION_COOKIE_NAME=agentops_session',
      'GOOGLE_CLIENT_ID=client-id',
      'GOOGLE_CLIENT_SECRET=client-secret',
      'GOOGLE_OAUTH_REDIRECT_URL=http://localhost:3005/api/auth/google/callback',
      'CIRCLE_WORKER_URL=http://127.0.0.1:8090',
      'CIRCLE_WORKER_PORT=8090',
      'CIRCLE_WORKER_TOKEN=12345678901234567890123456789012',
      `CIRCLE_PROFILE_MASTER_KEY=${Buffer.alloc(32, 7).toString('base64')}`,
    ].join('\n')),
    web: parseEnv([
      'AGENTOPS_API_BASE_URL=http://localhost:8080',
      'APP_BASE_URL=http://localhost:3005',
      'SESSION_COOKIE_NAME=agentops_session',
    ].join('\n')),
  };
}

test('parseEnv reads quoted and unquoted values without exposing comments as keys', () => {
  const env = parseEnv('A="hello world"\nB=plain\n# C=hidden\n');
  assert.equal(env.get('A'), 'hello world');
  assert.equal(env.get('B'), 'plain');
  assert.equal(env.has('C'), false);
});

test('setEnvValue replaces one key and preserves the remaining file', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agentops-env-'));
  const filePath = path.join(directory, '.env');
  await writeFile(filePath, 'A=old\nB=keep\n');
  await setEnvValue(filePath, 'A', 'new value');
  assert.equal(await readFile(filePath, 'utf8'), 'A="new value"\nB=keep\n');
});

test('mergeNonEmptyDefaults fills old env files without overwriting values or blank secrets', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'agentops-env-'));
  const targetPath = path.join(directory, '.env');
  const templatePath = path.join(directory, '.env.example');
  await writeFile(targetPath, 'PORT=9000\nGOOGLE_CLIENT_SECRET=existing\n');
  await writeFile(templatePath, 'PORT=8080\nAPP_BASE_URL=http://localhost:3005\nGOOGLE_CLIENT_SECRET=\n');
  await mergeNonEmptyDefaults(targetPath, templatePath);
  const merged = parseEnv(await readFile(targetPath, 'utf8'));
  assert.equal(merged.get('PORT'), '9000');
  assert.equal(merged.get('APP_BASE_URL'), 'http://localhost:3005');
  assert.equal(merged.get('GOOGLE_CLIENT_SECRET'), 'existing');
});

test('validateRuntimeConfig accepts the supported local service contract', () => {
  const { api, web } = validConfig();
  assert.deepEqual(validateRuntimeConfig(api, web), []);
});

test('validateRuntimeConfig rejects missing secrets and cross-service drift', () => {
  const { api, web } = validConfig();
  api.set('GOOGLE_CLIENT_SECRET', '');
  api.set('CIRCLE_WORKER_TOKEN', 'short');
  web.set('SESSION_COOKIE_NAME', 'different_cookie');
  const errors = validateRuntimeConfig(api, web);
  assert.ok(errors.some((error) => error.includes('GOOGLE_CLIENT_SECRET')));
  assert.ok(errors.some((error) => error.includes('at least 32')));
  assert.ok(errors.some((error) => error.includes('SESSION_COOKIE_NAME values must match')));
});

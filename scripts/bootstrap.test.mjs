import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composePath = path.join(root, 'deploy', 'docker-compose.testnet.yml');
const envExamplePath = path.join(root, '.env.example');

function serviceBlock(source, service) {
  const match = new RegExp(`^  ${service}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:|^networks:|^volumes:|\\Z)`, 'm')
    .exec(source);
  assert.ok(match, `missing ${service} service`);
  return match[0];
}

test('testnet manifest defines four application services with private dependencies', async () => {
  const source = await readFile(composePath, 'utf8');
  for (const service of ['web', 'api', 'mcp', 'circle-worker', 'postgres', 'redis']) {
    serviceBlock(source, service);
  }

  const postgres = serviceBlock(source, 'postgres');
  const redis = serviceBlock(source, 'redis');
  const worker = serviceBlock(source, 'circle-worker');
  const api = serviceBlock(source, 'api');
  const mcp = serviceBlock(source, 'mcp');
  const web = serviceBlock(source, 'web');

  assert.match(worker, /postgres:\s*\n\s+condition: service_healthy/);
  assert.match(api, /postgres:\s*\n\s+condition: service_healthy/);
  assert.match(api, /redis:\s*\n\s+condition: service_healthy/);
  assert.match(api, /circle-worker:\s*\n\s+condition: service_healthy/);
  assert.match(mcp, /api:\s*\n\s+condition: service_healthy/);
  assert.match(web, /api:\s*\n\s+condition: service_healthy/);

  for (const block of [worker, api, mcp]) assert.match(block, /\/readyz/);
  for (const block of [web, api, mcp]) assert.match(block, /^    ports:/m);
  for (const block of [postgres, redis, worker]) assert.doesNotMatch(block, /^    ports:/m);
  assert.match(postgres, /postgres-data:\/var\/lib\/postgresql\/data/);
});

test('testnet manifest keeps worker and payment-result secrets in separate processes', async () => {
  const source = await readFile(composePath, 'utf8');
  const worker = serviceBlock(source, 'circle-worker');
  const api = serviceBlock(source, 'api');

  assert.match(worker, /CIRCLE_PROFILE_MASTER_KEY:\s*\$\{CIRCLE_PROFILE_MASTER_KEY:\?[^}]+\}/);
  assert.doesNotMatch(worker, /X402_RESULT_ENCRYPTION_KEY:/);
  assert.match(api, /X402_RESULT_ENCRYPTION_KEY:\s*\$\{X402_RESULT_ENCRYPTION_KEY:\?[^}]+\}/);
  assert.doesNotMatch(api, /CIRCLE_PROFILE_MASTER_KEY:/);
  assert.match(api, /CIRCLE_WORKER_TIMEOUT_MS:/);
  assert.match(source, /ENABLE_TESTNET_X402_FIXTURES:\s*\$\{ENABLE_TESTNET_X402_FIXTURES:-false\}/);
  assert.doesNotMatch(source, /(?:secret|token|password):\s*["']?[A-Za-z0-9+/=_-]{16,}["']?\s*$/im);
});

test('deployment env and manifest use the canonical hosted MCP concurrency key', async () => {
  const [source, environment] = await Promise.all([
    readFile(composePath, 'utf8'),
    readFile(envExamplePath, 'utf8'),
  ]);

  assert.match(source, /MCP_MAX_IN_FLIGHT:\s*\$\{MCP_MAX_IN_FLIGHT:-\d+\}/);
  assert.match(environment, /^MCP_MAX_IN_FLIGHT=\d+$/m);
  assert.doesNotMatch(source + environment, /MCP_MAX_INFLIGHT_REQUESTS/);
  assert.match(environment, /^X402_RESULT_ENCRYPTION_KEY=$/m);
  assert.match(environment, /^CIRCLE_PROFILE_MASTER_KEY=$/m);
  assert.match(environment, /^CIRCLE_WORKER_TIMEOUT_MS=\d+$/m);
});

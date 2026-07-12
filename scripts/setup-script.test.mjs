import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const setup = path.join(root, 'setup.sh');
const startup = path.join(root, 'startup.sh');

test('bootstrap entrypoints are executable and syntactically valid Bash', async () => {
  execFileSync('bash', ['-n', setup, startup]);
  assert.notEqual((await stat(setup)).mode & 0o111, 0);
  assert.notEqual((await stat(startup)).mode & 0o111, 0);
});

test('setup and startup document the four-service command contract', () => {
  for (const command of [setup, startup]) {
    const result = spawnSync(command, ['--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage: \.\/setup\.sh \[--run-only\]/);
    assert.match(result.stdout, /web \(3005\)/);
    assert.match(result.stdout, /Hosted MCP \(8070\)/);
    assert.match(result.stdout, /API \(8080\)/);
    assert.match(result.stdout, /Circle worker \(8090\)/);
    assert.match(result.stdout, /four application services/);
  }
});

test('startup remains a compatibility wrapper around setup', async () => {
  const source = await readFile(startup, 'utf8');
  assert.match(source, /exec "\$ROOT_DIR\/setup\.sh" "\$@"/);
  assert.doesNotMatch(source, /start_service|wait-for-http|dev:mcp:http/);
});

test('setup supervises API, Hosted MCP, Circle worker, and web', async () => {
  const source = await readFile(setup, 'utf8');
  const serviceCalls = [...source.matchAll(/^\s*start_service (\S+) (.+)$/gm)].map(
    ([, name, command]) => ({ name, command }),
  );
  const services = new Map(serviceCalls.map((service) => [service.name, service.command]));

  assert.equal(serviceCalls.length, 4);
  assert.deepEqual(services, new Map([
    ['api', 'npm run dev:api'],
    ['mcp', 'npm run dev:mcp:http'],
    ['circle-worker', 'npm run dev:circle-worker'],
    ['web', 'npm --workspace @agentops-pmoa/web run dev -- --port 3005'],
  ]));

  assert.match(source, /"\$@" >"\$LOG_DIR\/\$name\.log" 2>&1 &/);
  assert.match(source, />"\$RUNTIME_DIR\/\$name\.pid"/);
  assert.equal(`${serviceCalls.find(({ name }) => name === 'mcp').name}.log`, 'mcp.log');
  assert.equal(`${serviceCalls.find(({ name }) => name === 'mcp').name}.pid`, 'mcp.pid');

  for (const port of [3005, 8070, 8080, 8090]) {
    assert.match(source, new RegExp(`port_available_for_app ${port}`));
  }
  for (const healthUrl of [
    'http://127.0.0.1:8080/healthz',
    'http://127.0.0.1:8070/healthz',
    'http://127.0.0.1:8090/healthz',
    'http://127.0.0.1:3005/',
  ]) {
    assert.match(source, new RegExp(healthUrl.replaceAll('.', '\\.')));
  }

  const lastStart = Math.max(...serviceCalls.map(({ name }) => source.indexOf(`start_service ${name} `)));
  const firstHealth = source.indexOf('wait-for-http.mjs');
  assert.ok(lastStart < firstHealth, 'all four services must start before readiness health checks');

  assert.match(source, /Hosted MCP:\s+http:\/\/localhost:8070\/mcp/);
  assert.match(source, /Hosted MCP health:\s+http:\/\/127\.0\.0\.1:8070\/healthz/);
  assert.match(source, /stop all four application services/);
});

test('setup rejects unsupported arguments before changing the environment', () => {
  const result = spawnSync(setup, ['--unknown'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: \.\/setup\.sh/);
});

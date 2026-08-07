import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const setup = path.join(root, 'setup.sh');
const startup = path.join(root, 'startup.sh');
const shellQuote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;

test('bootstrap entrypoints are executable and syntactically valid Bash', async () => {
  execFileSync('bash', ['-n', setup, startup]);
  assert.notEqual((await stat(setup)).mode & 0o111, 0);
  assert.notEqual((await stat(startup)).mode & 0o111, 0);
});

test('setup generates distinct persistent 32-byte encryption keys for API results and worker profiles', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentops-secrets-'));
  const apiEnv = path.join(temporaryRoot, 'api.env');
  const webEnv = path.join(temporaryRoot, 'web.env');
  await Promise.all([writeFile(apiEnv, ''), writeFile(webEnv, '')]);
  const generate = `
    export AGENTOPS_SETUP_LIB_ONLY=true
    source ${shellQuote(setup)}
    API_ENV=${shellQuote(apiEnv)}
    WEB_ENV=${shellQuote(webEnv)}
    generate_internal_secrets
    generate_internal_secrets
  `;

  try {
    const result = spawnSync('bash', ['-c', generate], { encoding: 'utf8' });
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    const contents = await readFile(apiEnv, 'utf8');
    const profileKey = /^CIRCLE_PROFILE_MASTER_KEY=(.+)$/m.exec(contents)?.[1];
    const resultKey = /^X402_RESULT_ENCRYPTION_KEY=(.+)$/m.exec(contents)?.[1];
    assert.ok(profileKey);
    assert.ok(resultKey);
    assert.equal(Buffer.from(profileKey, 'base64').length, 32);
    assert.equal(Buffer.from(resultKey, 'base64').length, 32);
    assert.notEqual(profileKey, resultKey);
    assert.equal((contents.match(/^CIRCLE_PROFILE_MASTER_KEY=/gm) ?? []).length, 1);
    assert.equal((contents.match(/^X402_RESULT_ENCRYPTION_KEY=/gm) ?? []).length, 1);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
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
    [
      'mcp',
      'env -u AGENTOPS_MCP_CREDENTIAL NODE_ENV=development AGENTOPS_API_BASE_URL=http://localhost:8080 MCP_HOST=127.0.0.1 MCP_PORT=8070 MCP_PUBLIC_URL=http://127.0.0.1:8070/mcp MCP_ALLOWED_HOSTS=127.0.0.1:8070,localhost:8070 MCP_ALLOWED_ORIGINS=http://localhost:3005,http://127.0.0.1:3005 npm run dev:mcp:http',
    ],
    ['circle-worker', 'npm run dev:circle-worker'],
    ['web', 'env MCP_PUBLIC_URL=http://127.0.0.1:8070/mcp npm --workspace @agentops-pmoa/web run dev -- --port 3005'],
  ]));

  assert.match(source, /SERVICE_NAMES\+=\("\$name"\)/);
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
  const firstHealth = source.indexOf('wait_for_service_health API');
  assert.ok(lastStart < firstHealth, 'all four services must start before readiness health checks');

  assert.match(source, /Hosted MCP:\s+http:\/\/127\.0\.0\.1:8070\/mcp/);
  assert.match(source, /Hosted MCP health:\s+http:\/\/127\.0\.0\.1:8070\/healthz/);
  assert.match(source, /stop all four application services/);
});

test('sourced supervisor helpers monitor health, exits, logs, pids, and shutdown', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentops-supervisor-'));
  const runtime = path.join(temporaryRoot, 'runtime');
  const portFile = path.join(temporaryRoot, 'port');
  const mockRoot = path.join(temporaryRoot, 'mock-root');
  const probeMarker = path.join(temporaryRoot, 'probe-started');
  const server = [
    "const fs = require('node:fs');",
    "const http = require('node:http');",
    "const server = http.createServer((request, response) => { response.writeHead(200); response.end('ok'); });",
    `server.listen(0, '127.0.0.1', () => fs.writeFileSync(process.argv[1], String(server.address().port)));`,
  ].join(' ');
  await mkdir(path.join(mockRoot, 'scripts'), { recursive: true });
  await writeFile(
    path.join(mockRoot, 'scripts', 'wait-for-http.mjs'),
    "import fs from 'node:fs'; fs.writeFileSync(process.env.PROBE_MARKER, 'started'); setTimeout(() => process.exit(0), 50);\n",
  );
  const exitsAfterProbeStarts = [
    "const fs = require('node:fs');",
    'const marker = process.argv[1];',
    "const poll = () => fs.existsSync(marker) ? setTimeout(() => process.exit(7), 20) : setTimeout(poll, 1);",
    'poll();',
  ].join(' ');
  const script = `
    export AGENTOPS_SETUP_LIB_ONLY=true
    source ${shellQuote(setup)}
    RUNTIME_DIR=${shellQuote(runtime)}
    LOG_DIR="$RUNTIME_DIR/logs"
    mkdir -p "$LOG_DIR"
    trap shutdown EXIT INT TERM

    start_service healthy node -e ${shellQuote(server)} ${shellQuote(portFile)}
    healthy_pid="\${SERVICE_PIDS[0]}"
    for _ in {1..100}; do
      [[ -s ${shellQuote(portFile)} ]] && break
      sleep 0.02
    done
    [[ -s ${shellQuote(portFile)} ]]
    port="$(<${shellQuote(portFile)})"
    wait_for_service_health Healthy "http://127.0.0.1:$port/healthz" 5000
    [[ -f "$RUNTIME_DIR/healthy.pid" ]]
    [[ -f "$LOG_DIR/healthy.log" ]]

    ROOT_DIR=${shellQuote(mockRoot)}
    export PROBE_MARKER=${shellQuote(probeMarker)}
    start_service doomed node -e ${shellQuote(exitsAfterProbeStarts)} ${shellQuote(probeMarker)}
    doomed_pid="\${SERVICE_PIDS[1]}"
    started="$(node -e 'process.stdout.write(String(Date.now()))')"
    if wait_for_service_health SuccessfulProbe http://127.0.0.1:1/healthz 10000; then
      exit 20
    fi
    elapsed="$(( $(node -e 'process.stdout.write(String(Date.now()))') - started ))"
    [[ "$FAILED_SERVICE_NAME" == doomed ]]
    [[ "$FAILED_SERVICE_STATUS" == 7 ]]
    [[ "$elapsed" -lt 3000 ]]
    [[ -f "$RUNTIME_DIR/doomed.pid" ]]
    [[ -f "$LOG_DIR/doomed.log" ]]
    printf 'failure=%s:%s elapsed=%s\n' "$FAILED_SERVICE_NAME" "$FAILED_SERVICE_STATUS" "$elapsed"

    shutdown
    trap - EXIT
    [[ ! -e "$RUNTIME_DIR/healthy.pid" ]]
    [[ ! -e "$RUNTIME_DIR/doomed.pid" ]]
    ! kill -0 "$healthy_pid" 2>/dev/null
    ! kill -0 "$doomed_pid" 2>/dev/null
    printf 'shutdown=clean\n'
  `;

  try {
    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /failure=doomed:7 elapsed=\d+/);
    assert.match(result.stdout, /shutdown=clean/);
    assert.doesNotMatch(result.stdout + result.stderr, /AGENTOPS_MCP_CREDENTIAL/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('failed health probe attributes a sibling exit from the final polling gap', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentops-failed-probe-'));
  const runtime = path.join(temporaryRoot, 'runtime');
  const mockRoot = path.join(temporaryRoot, 'mock-root');
  const probeMarker = path.join(temporaryRoot, 'probe-started');
  const exitsAfterProbeStarts = [
    "const fs = require('node:fs');",
    'const marker = process.argv[1];',
    "const poll = () => fs.existsSync(marker) ? setTimeout(() => process.exit(7), 20) : setTimeout(poll, 1);",
    'poll();',
  ].join(' ');

  await mkdir(path.join(mockRoot, 'scripts'), { recursive: true });
  await writeFile(
    path.join(mockRoot, 'scripts', 'wait-for-http.mjs'),
    "import fs from 'node:fs'; fs.writeFileSync(process.env.PROBE_MARKER, 'started'); setTimeout(() => process.exit(9), 50);\n",
  );
  const script = `
    export AGENTOPS_SETUP_LIB_ONLY=true
    source ${shellQuote(setup)}
    ROOT_DIR=${shellQuote(mockRoot)}
    RUNTIME_DIR=${shellQuote(runtime)}
    LOG_DIR="$RUNTIME_DIR/logs"
    export PROBE_MARKER=${shellQuote(probeMarker)}
    mkdir -p "$LOG_DIR"
    trap shutdown EXIT INT TERM

    start_service sibling node -e ${shellQuote(exitsAfterProbeStarts)} ${shellQuote(probeMarker)}
    if wait_for_service_health FailingProbe http://127.0.0.1:1/healthz 10000; then
      exit 20
    fi
    [[ "$FAILED_SERVICE_NAME" == sibling ]]
    [[ "$FAILED_SERVICE_STATUS" == 7 ]]
    printf 'diagnostic=%s:%s\n' "$FAILED_SERVICE_NAME" "$FAILED_SERVICE_STATUS"

    shutdown
    trap - EXIT
    [[ ! -e "$RUNTIME_DIR/sibling.pid" ]]
  `;

  try {
    const result = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /diagnostic=sibling:7/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('setup rejects unsupported arguments before changing the environment', () => {
  const result = spawnSync(setup, ['--unknown'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: \.\/setup\.sh/);
});

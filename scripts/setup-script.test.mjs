import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
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

test('setup and startup expose the same documented command contract', () => {
  for (const command of [setup, startup]) {
    const result = spawnSync(command, ['--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage: \.\/setup\.sh \[--run-only\]/);
    assert.match(result.stdout, /Circle worker \(8090\)/);
  }
});

test('setup rejects unsupported arguments before changing the environment', () => {
  const result = spawnSync(setup, ['--unknown'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: \.\/setup\.sh/);
});

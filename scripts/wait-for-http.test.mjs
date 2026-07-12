import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'wait-for-http.mjs');

function runWaiter(url, timeout = 2_000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, 'test service', url, String(timeout)]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stderr, stdout }));
  });
}

async function withServer(status, operation) {
  const server = http.createServer((_request, response) => {
    response.writeHead(status);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  try {
    return await operation(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
  }
}

test('wait-for-http accepts a healthy service', async () => {
  const result = await withServer(204, (url) => runWaiter(url));
  assert.equal(result.code, 0);
  assert.match(result.stdout, /test service ready \(204\)/);
});

test('wait-for-http does not treat a missing route as healthy', async () => {
  const result = await withServer(404, (url) => runWaiter(url, 600));
  assert.equal(result.code, 1);
  assert.match(result.stderr, /did not become ready/);
});

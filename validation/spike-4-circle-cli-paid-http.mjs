import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const cli = new URL('../node_modules/@circle-fin/cli/dist/index.js', import.meta.url);
const required = [
  '-X, --method <method>',
  '-d, --data <data>',
  '-H, --header <header>',
  '--timeout <seconds>',
  '-o, --output <fmt>',
];

for (let run = 1; run <= 3; run += 1) {
  const help = execFileSync(process.execPath, [cli.pathname, 'services', 'pay', '--help'], {
    encoding: 'utf8',
  });
  for (const capability of required) assert.ok(help.includes(capability), capability);
  assert.match(help, /GET, POST, PUT, DELETE, PATCH/);
  assert.match(help, /Response body only/);
}

console.log(JSON.stringify({ result: 'PASS', runs: 3, required }));

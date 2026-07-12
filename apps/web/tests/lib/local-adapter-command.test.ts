import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildLocalAdapterCommand } from '../../src/lib/local-adapter-command.js';

describe('buildLocalAdapterCommand', () => {
  it('builds one executable command whose inline environment reaches the child process', () => {
    const credential = 'conn_semantics_probe';
    const command = buildLocalAdapterCommand(credential);
    const runSuffix = ' npm run dev:mcp';

    expect(command).toBe(
      `AGENTOPS_API_BASE_URL=http://localhost:8080 AGENTOPS_MCP_CREDENTIAL=${credential} npm run dev:mcp`,
    );
    expect(command).not.toContain('\n');
    expect(command.endsWith(runSuffix)).toBe(true);

    const inlineEnvironment = command.slice(0, -runSuffix.length);
    const childCheck = [
      `process.env.AGENTOPS_API_BASE_URL === 'http://localhost:8080'`,
      `process.env.AGENTOPS_MCP_CREDENTIAL === '${credential}'`,
    ].join(' && ');
    const probe = `${inlineEnvironment} ${JSON.stringify(process.execPath)} -e ${JSON.stringify(`process.exit(${childCheck} ? 0 : 1)`)}`;
    const result = spawnSync('/bin/sh', ['-c', probe], {
      encoding: 'utf8',
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });
});

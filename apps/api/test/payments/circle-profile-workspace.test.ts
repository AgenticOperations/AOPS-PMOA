import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  withCircleProfileWorkspace,
  type CircleProfileBundle,
} from '../../src/engines/payments/circle-profile-workspace.js';

describe('Circle profile workspace', () => {
  it('restores and captures only the allowlisted Circle profile files', async () => {
    const bundle: CircleProfileBundle = {
      files: {
        '.circle-cli/profiles/agent/session.json': Buffer.from('{"email":"owner@example.com"}').toString('base64'),
      },
      version: 1,
    };

    const outcome = await withCircleProfileWorkspace(bundle, async ({ environment, root }) => {
      expect(environment.CIRCLE_CLI_HOME).toBe(`${root}/.circle-cli`);
      expect(environment.HOME).toBe(root);
      expect(await readFile(`${root}/.circle-cli/profiles/agent/session.json`, 'utf8')).toContain('owner@example.com');

      await mkdir(`${root}/.circle/login-requests`, { recursive: true });
      await writeFile(`${root}/.circle/login-requests/68c34a64-bf7a-4ca5-a2ac-125cab514bc9.json`, '{"requestId":"68c34"}');
      await mkdir(`${root}/.circle-cli/payments`, { recursive: true });
      await writeFile(`${root}/.circle-cli/payments/debug.json`, '{"secret":"must-not-persist"}');
      return 'ok';
    });

    expect(outcome.result).toBe('ok');
    expect(outcome.bundle.files).toHaveProperty('.circle-cli/profiles/agent/session.json');
    expect(outcome.bundle.files).toHaveProperty('.circle/login-requests/68c34a64-bf7a-4ca5-a2ac-125cab514bc9.json');
    expect(outcome.bundle.files).not.toHaveProperty('.circle-cli/payments/debug.json');
    await expect(access(outcome.root)).rejects.toThrow();
  });

  it('rejects profile paths outside the allowlist', async () => {
    const bundle: CircleProfileBundle = {
      files: {
        '../../etc/passwd': Buffer.from('bad').toString('base64'),
      },
      version: 1,
    };

    await expect(withCircleProfileWorkspace(bundle, () => Promise.resolve(null))).rejects.toThrow('circle_profile_path_not_allowed');
  });

  it('deletes the plaintext workspace when the operation fails', async () => {
    let root = '';

    await expect(withCircleProfileWorkspace(null, async (workspace) => {
      root = workspace.root;
      await writeFile(`${root}/secret.txt`, 'sensitive');
      throw new Error('provider_failed');
    })).rejects.toThrow('provider_failed');

    await expect(access(root)).rejects.toThrow();
  });
});

import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

const MAX_PROFILE_FILE_BYTES = 1024 * 1024;
const STATIC_PROFILE_PATHS = new Set([
  '.circle-cli/blockchains.json',
  '.circle-cli/config.json',
  '.circle-cli/profiles/agent/session.json',
]);
const LOGIN_REQUEST_PATTERN = /^\.circle\/login-requests\/[0-9a-f-]{36}\.json$/i;

export type CircleProfileBundle = {
  readonly files: Readonly<Record<string, string>>;
  readonly version: 1;
};

export type CircleProfileWorkspace = {
  readonly environment: NodeJS.ProcessEnv;
  readonly root: string;
};

export type CircleProfileWorkspaceResult<T> = {
  readonly bundle: CircleProfileBundle;
  readonly result: T;
  readonly root: string;
};

function assertAllowedProfilePath(path: string): void {
  if (!STATIC_PROFILE_PATHS.has(path) && !LOGIN_REQUEST_PATTERN.test(path)) {
    throw new Error('circle_profile_path_not_allowed');
  }
}

function targetPath(root: string, profilePath: string): string {
  assertAllowedProfilePath(profilePath);
  const target = resolve(root, profilePath);
  const insideRoot = relative(root, target);
  if (insideRoot.startsWith(`..${sep}`) || insideRoot === '..' || insideRoot.length === 0) {
    throw new Error('circle_profile_path_not_allowed');
  }
  return target;
}

async function restoreBundle(root: string, bundle: CircleProfileBundle | null): Promise<void> {
  if (bundle === null) return;
  if (bundle.version !== 1) throw new Error('circle_profile_bundle_version_unsupported');
  for (const [profilePath, encoded] of Object.entries(bundle.files)) {
    const target = targetPath(root, profilePath);
    const content = Buffer.from(encoded, 'base64');
    if (content.byteLength > MAX_PROFILE_FILE_BYTES) throw new Error('circle_profile_file_too_large');
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, content, { mode: 0o600 });
  }
}

async function captureFile(root: string, profilePath: string, files: Record<string, string>): Promise<void> {
  const target = targetPath(root, profilePath);
  let info;
  try {
    info = await lstat(target);
  } catch {
    return;
  }
  if (!info.isFile() || info.isSymbolicLink()) return;
  if (info.size > MAX_PROFILE_FILE_BYTES) throw new Error('circle_profile_file_too_large');
  files[profilePath] = (await readFile(target)).toString('base64');
}

async function captureBundle(root: string): Promise<CircleProfileBundle> {
  const files: Record<string, string> = {};
  for (const profilePath of STATIC_PROFILE_PATHS) await captureFile(root, profilePath, files);

  const requestDirectory = join(root, '.circle', 'login-requests');
  try {
    const entries = await readdir(requestDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const profilePath = `.circle/login-requests/${entry.name}`;
      if (LOGIN_REQUEST_PATTERN.test(profilePath)) await captureFile(root, profilePath, files);
    }
  } catch {
    // A completed login removes its request file.
  }

  return { files, version: 1 };
}

export async function withCircleProfileWorkspace<T>(
  bundle: CircleProfileBundle | null,
  operation: (workspace: CircleProfileWorkspace) => Promise<T>,
): Promise<CircleProfileWorkspaceResult<T>> {
  const root = await mkdtemp(join(tmpdir(), 'agentops-circle-'));
  await chmod(root, 0o700);
  try {
    await restoreBundle(root, bundle);
    const result = await operation({
      environment: {
        CIRCLE_ACCEPT_TERMS: '1',
        CIRCLE_CLI_HOME: join(root, '.circle-cli'),
        HOME: root,
      },
      root,
    });
    return { bundle: await captureBundle(root), result, root };
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

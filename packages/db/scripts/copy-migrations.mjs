import { cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(packageDir, 'src', 'migrations');
const target = join(packageDir, 'dist', 'src', 'migrations');

rmSync(target, { force: true, recursive: true });
cpSync(source, target, { recursive: true });

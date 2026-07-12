import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

function decodeValue(rawValue) {
  const value = rawValue.trim();
  if (value.length === 0) return '';
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

export function parseEnv(contents) {
  const values = new Map();
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match === null) continue;
    values.set(match[1], decodeValue(match[2]));
  }
  return values;
}

export async function readEnvFile(filePath) {
  return parseEnv(await readFile(filePath, 'utf8'));
}

function encodeValue(value) {
  if (value.includes('\n') || value.includes('\r')) {
    throw new Error('Environment values cannot contain newlines.');
  }
  return JSON.stringify(value);
}

export async function setEnvValue(filePath, key, value) {
  if (!KEY_PATTERN.test(key)) throw new Error(`Invalid environment key: ${key}`);
  const current = await readFile(filePath, 'utf8');
  const replacement = `${key}=${encodeValue(value)}`;
  const lines = current.split(/\r?\n/);
  let replaced = false;
  const next = lines.map((line) => {
    if (new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line)) {
      replaced = true;
      return replacement;
    }
    return line;
  });
  if (!replaced) {
    if (next.length > 0 && next[next.length - 1] !== '') next.push('');
    next.push(replacement);
  }
  await writeFile(filePath, `${next.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });
}

export async function mergeNonEmptyDefaults(targetPath, templatePath) {
  const target = await readEnvFile(targetPath);
  const template = await readEnvFile(templatePath);
  for (const [key, value] of template) {
    if (value.length > 0 && (target.get(key)?.trim().length ?? 0) === 0) {
      await setEnvValue(targetPath, key, value);
      target.set(key, value);
    }
  }
}

function required(env, key, label, errors) {
  const value = env.get(key)?.trim() ?? '';
  if (value.length === 0) errors.push(`${label}: ${key} is required`);
  return value;
}

function validUrl(value, key, protocols, errors) {
  try {
    const url = new URL(value);
    if (!protocols.includes(url.protocol)) errors.push(`${key} must use ${protocols.join(' or ')}`);
    return url;
  } catch {
    errors.push(`${key} must be a valid URL`);
    return null;
  }
}

export function validateRuntimeConfig(api, web) {
  const errors = [];
  const databaseUrl = required(api, 'DATABASE_URL', 'API', errors);
  const redisUrl = required(api, 'REDIS_URL', 'API', errors);
  const apiAppBase = required(api, 'APP_BASE_URL', 'API', errors);
  const apiCookie = required(api, 'SESSION_COOKIE_NAME', 'API', errors);
  required(api, 'GOOGLE_CLIENT_ID', 'API', errors);
  required(api, 'GOOGLE_CLIENT_SECRET', 'API', errors);
  const oauthRedirect = required(api, 'GOOGLE_OAUTH_REDIRECT_URL', 'API', errors);
  const workerUrl = required(api, 'CIRCLE_WORKER_URL', 'API', errors);
  const workerToken = required(api, 'CIRCLE_WORKER_TOKEN', 'API', errors);
  const profileKey = required(api, 'CIRCLE_PROFILE_MASTER_KEY', 'API', errors);
  const apiPort = required(api, 'PORT', 'API', errors);
  const workerPort = required(api, 'CIRCLE_WORKER_PORT', 'API', errors);

  const webApiBase = required(web, 'AGENTOPS_API_BASE_URL', 'Web', errors);
  const webAppBase = required(web, 'APP_BASE_URL', 'Web', errors);
  const webCookie = required(web, 'SESSION_COOKIE_NAME', 'Web', errors);

  if (databaseUrl.length > 0) validUrl(databaseUrl, 'DATABASE_URL', ['postgres:', 'postgresql:'], errors);
  if (redisUrl.length > 0) validUrl(redisUrl, 'REDIS_URL', ['redis:', 'rediss:'], errors);
  const apiAppUrl = apiAppBase.length > 0 ? validUrl(apiAppBase, 'API APP_BASE_URL', ['http:', 'https:'], errors) : null;
  const webAppUrl = webAppBase.length > 0 ? validUrl(webAppBase, 'Web APP_BASE_URL', ['http:', 'https:'], errors) : null;
  const webApiUrl = webApiBase.length > 0 ? validUrl(webApiBase, 'AGENTOPS_API_BASE_URL', ['http:', 'https:'], errors) : null;
  const oauthUrl = oauthRedirect.length > 0 ? validUrl(oauthRedirect, 'GOOGLE_OAUTH_REDIRECT_URL', ['http:', 'https:'], errors) : null;
  const circleWorkerUrl = workerUrl.length > 0 ? validUrl(workerUrl, 'CIRCLE_WORKER_URL', ['http:', 'https:'], errors) : null;

  if (apiPort !== '' && apiPort !== '8080') errors.push('PORT must be 8080 for the supported local stack');
  if (workerPort !== '' && workerPort !== '8090') errors.push('CIRCLE_WORKER_PORT must be 8090 for the supported local stack');
  if (apiAppUrl !== null && apiAppUrl.port !== '3005') errors.push('API APP_BASE_URL must use port 3005');
  if (webAppUrl !== null && webAppUrl.port !== '3005') errors.push('Web APP_BASE_URL must use port 3005');
  if (webApiUrl !== null && webApiUrl.port !== '8080') errors.push('AGENTOPS_API_BASE_URL must use port 8080');
  if (circleWorkerUrl !== null && circleWorkerUrl.port !== '8090') errors.push('CIRCLE_WORKER_URL must use port 8090');
  if (oauthUrl !== null && oauthUrl.pathname !== '/api/auth/google/callback') {
    errors.push('GOOGLE_OAUTH_REDIRECT_URL must end with /api/auth/google/callback');
  }
  if (apiAppBase !== webAppBase) errors.push('API and web APP_BASE_URL values must match');
  if (apiCookie !== webCookie) errors.push('API and web SESSION_COOKIE_NAME values must match');
  if (workerToken.length > 0 && workerToken.length < 32) errors.push('CIRCLE_WORKER_TOKEN must contain at least 32 characters');
  if (profileKey.length > 0) {
    const decoded = Buffer.from(profileKey, 'base64');
    if (decoded.length !== 32 || decoded.toString('base64').replace(/=+$/, '') !== profileKey.replace(/=+$/, '')) {
      errors.push('CIRCLE_PROFILE_MASTER_KEY must be a base64-encoded 32-byte key');
    }
  }
  return errors;
}

async function main(argv) {
  const [command, ...args] = argv;
  if (command === 'get') {
    const [filePath, key] = args;
    if (filePath === undefined || key === undefined) throw new Error('Usage: env-file.mjs get <file> <key>');
    process.stdout.write((await readEnvFile(filePath)).get(key) ?? '');
    return;
  }
  if (command === 'set') {
    const [filePath, key] = args;
    if (filePath === undefined || key === undefined) throw new Error('Usage: env-file.mjs set <file> <key>');
    let value = '';
    for await (const chunk of process.stdin) value += chunk;
    await setEnvValue(filePath, key, value);
    return;
  }
  if (command === 'validate') {
    const [apiPath, webPath] = args;
    if (apiPath === undefined || webPath === undefined) throw new Error('Usage: env-file.mjs validate <api-env> <web-env>');
    const errors = validateRuntimeConfig(await readEnvFile(apiPath), await readEnvFile(webPath));
    if (errors.length > 0) {
      for (const error of errors) process.stderr.write(`- ${error}\n`);
      process.exitCode = 1;
    }
    return;
  }
  if (command === 'merge') {
    const [targetPath, templatePath] = args;
    if (targetPath === undefined || templatePath === undefined) {
      throw new Error('Usage: env-file.mjs merge <target-env> <template-env>');
    }
    await mergeNonEmptyDefaults(targetPath, templatePath);
    return;
  }
  throw new Error('Usage: env-file.mjs <get|set|merge|validate> ...');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

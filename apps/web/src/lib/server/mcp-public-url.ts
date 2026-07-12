import 'server-only';

const LOCAL_MCP_URL = 'http://localhost:8070/mcp';
const KNOWN_NODE_ENVS = new Set(['development', 'test', 'production']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseExactMcpUrl(value: string): URL | null {
  if (
    value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
    || value.includes('?')
    || value.includes('#')
  ) return null;
  try {
    const url = new URL(value);
    if (url.toString() !== value) return null;
    const authorityStart = value.indexOf('//') + 2;
    const authorityEnd = value.indexOf('/', authorityStart);
    const authority = value.slice(authorityStart, authorityEnd === -1 ? undefined : authorityEnd);
    if (
      url.pathname !== '/mcp'
      || authority.includes('@')
      || url.username !== ''
      || url.password !== ''
      || url.search !== ''
      || url.hash !== ''
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function resolveMcpPublicUrl(env: NodeJS.ProcessEnv = process.env): string {
  const nodeEnv = env.NODE_ENV;
  if (nodeEnv === undefined || !KNOWN_NODE_ENVS.has(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  const configured = env.MCP_PUBLIC_URL;
  if (nodeEnv === 'production' && (configured === undefined || configured === '')) {
    throw new Error('MCP_PUBLIC_URL is required in production');
  }

  const value = configured === undefined || configured === '' ? LOCAL_MCP_URL : configured;
  const url = parseExactMcpUrl(value);

  if (nodeEnv === 'production') {
    if (url === null || url.protocol !== 'https:') {
      throw new Error('MCP_PUBLIC_URL must be an HTTPS URL with the exact /mcp path');
    }
    return url.toString();
  }

  if (
    url === null
    || (url.protocol !== 'https:' && (
      url.protocol !== 'http:'
      || !LOOPBACK_HOSTS.has(url.hostname)
    ))
  ) {
    throw new Error('MCP_PUBLIC_URL must use HTTPS or explicit HTTP loopback with the exact /mcp path');
  }

  return url.toString();
}

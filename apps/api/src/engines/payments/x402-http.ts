import { createHash, type Hash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type PaidHttpBody =
  | { readonly kind: 'json'; readonly value: unknown }
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'base64'; readonly value: string };

export type PaidHttpRequest = {
  readonly url: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly headers: readonly (readonly [string, string])[];
  readonly body?: PaidHttpBody;
};

export type NormalizedPaidHttpRequest = Omit<PaidHttpRequest, 'body'> & {
  readonly body?: Uint8Array;
};

const MAX_PAID_HTTP_BODY_BYTES = 256 * 1024;
const DENIED_PAID_HTTP_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade',
  'payment-signature',
  'payment-response',
  'payment-required',
  'x-payment',
]);

function stableJsonStringify(value: unknown): string {
  const ancestors = new Set<object>();

  function serialize(current: unknown, key: string): string | undefined {
    const toJson = (
      current as { readonly toJSON?: (propertyKey: string) => unknown }
    )?.toJSON;
    if (
      current !== null &&
      typeof current === 'object' &&
      typeof toJson === 'function'
    ) {
      return serialize(toJson.call(current, key), key);
    }

    if (current === null) return 'null';
    if (typeof current === 'string') return JSON.stringify(current);
    if (typeof current === 'boolean') return current ? 'true' : 'false';
    if (typeof current === 'number') {
      return Number.isFinite(current) ? JSON.stringify(current) : 'null';
    }
    if (typeof current === 'bigint') {
      throw new TypeError('JSON body cannot contain bigint values');
    }
    if (typeof current !== 'object') return undefined;

    if (ancestors.has(current)) {
      throw new TypeError('JSON body cannot contain circular references');
    }
    ancestors.add(current);

    let result: string;
    if (Array.isArray(current)) {
      result = `[${Array.from(
        current,
        (item, index) => serialize(item, String(index)) ?? 'null',
      ).join(',')}]`;
    } else {
      const entries = Object.keys(current)
        .sort()
        .flatMap((entryKey) => {
          const serialized = serialize(
            (current as Record<string, unknown>)[entryKey],
            entryKey,
          );
          return serialized === undefined
            ? []
            : [`${JSON.stringify(entryKey)}:${serialized}`];
        });
      result = `{${entries.join(',')}}`;
    }

    ancestors.delete(current);
    return result;
  }

  const serialized = serialize(value, '');
  if (serialized === undefined) {
    throw new TypeError('JSON body must be serializable');
  }
  return serialized;
}

export function normalizePaidHttpRequest(
  request: PaidHttpRequest,
): NormalizedPaidHttpRequest {
  try {
    const parsedUrl = new URL(request.url);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw new TypeError('Paid HTTP URL must use HTTP or HTTPS');
    }
  } catch (error) {
    if (error instanceof TypeError && /Paid HTTP URL/.test(error.message)) {
      throw error;
    }
    throw new TypeError('Invalid paid HTTP URL', { cause: error });
  }

  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    throw new TypeError(`Unsupported paid HTTP method: ${request.method}`);
  }
  if (request.method === 'GET' && request.body !== undefined) {
    throw new TypeError('GET paid HTTP requests cannot include a body');
  }
  for (const [name] of request.headers) {
    const normalizedName = name.toLowerCase();
    if (
      DENIED_PAID_HTTP_HEADERS.has(normalizedName) ||
      normalizedName.startsWith('proxy-') ||
      normalizedName.startsWith('x-payment-')
    ) {
      throw new TypeError(`Paid HTTP header is not allowed: ${name}`);
    }
  }

  const body = request.body;
  if (body === undefined) {
    return {
      url: request.url,
      method: request.method,
      headers: request.headers,
    };
  }

  let bytes: Uint8Array;
  switch (body.kind) {
    case 'json':
      bytes = new TextEncoder().encode(stableJsonStringify(body.value));
      break;
    case 'text':
      bytes = new TextEncoder().encode(body.value);
      break;
    case 'base64': {
      const unpadded = body.value.replace(/=+$/, '');
      if (
        !/^[A-Za-z0-9+/]*={0,2}$/.test(body.value) ||
        unpadded.length % 4 === 1 ||
        (body.value.includes('=') && body.value.length % 4 !== 0)
      ) {
        throw new TypeError('Invalid base64 paid HTTP body');
      }
      const decoded = Buffer.from(body.value, 'base64');
      if (decoded.toString('base64').replace(/=+$/, '') !== unpadded) {
        throw new TypeError('Invalid base64 paid HTTP body');
      }
      bytes = decoded;
      break;
    }
    default:
      throw new TypeError(
        `Unsupported paid HTTP body encoding: ${String((body as { kind: unknown }).kind)}`,
      );
  }

  if (bytes.byteLength > MAX_PAID_HTTP_BODY_BYTES) {
    throw new RangeError('Paid HTTP body exceeds the 256 KiB decoded limit');
  }

  return {
    ...request,
    body: bytes,
  };
}

function updateHashField(hash: Hash, value: string | Uint8Array): void {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  hash.update(String(bytes.byteLength));
  hash.update(':');
  hash.update(bytes);
}

export function canonicalPaidHttpRequestHash(request: PaidHttpRequest): string {
  const normalized = normalizePaidHttpRequest(request);
  const hash = createHash('sha256');

  updateHashField(hash, normalized.method);
  updateHashField(hash, normalized.url);
  updateHashField(hash, String(normalized.headers.length));
  for (const [name, value] of normalized.headers) {
    updateHashField(hash, name.toLowerCase());
    updateHashField(hash, value);
  }
  updateHashField(hash, normalized.body === undefined ? '0' : '1');
  if (normalized.body !== undefined) updateHashField(hash, normalized.body);

  return hash.digest('hex');
}

export type PaidHttpDnsResolver = (
  hostname: string,
) => Promise<readonly (string | { readonly address: string })[]>;

export type PaidHttpUrlPolicy = {
  readonly allowHttpOrigins?: readonly string[];
  readonly resolveHostname?: PaidHttpDnsResolver;
};

function parseIpv4(
  address: string,
): readonly [number, number, number, number] | undefined {
  if (isIP(address) !== 4) return undefined;
  const [first, second, third, fourth] = address.split('.').map(Number);
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined
  ) {
    return undefined;
  }
  return [first, second, third, fourth];
}

function isUnsafeIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (octets === undefined) return false;
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function parseIpv6(address: string): Uint8Array | undefined {
  let [normalized] = address.toLowerCase().split('%', 1);
  if (normalized === undefined) return undefined;
  if (isIP(normalized) !== 6) return undefined;

  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':');
    const ipv4 = parseIpv4(normalized.slice(lastColon + 1));
    if (ipv4 === undefined) return undefined;
    normalized = `${normalized.slice(0, lastColon)}:${(
      (ipv4[0] << 8) |
      ipv4[1]
    ).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return undefined;
  const [leftHalf = '', rightHalf = ''] = halves;
  const left = leftHalf === '' ? [] : leftHalf.split(':');
  const right =
    halves.length === 1 || rightHalf === '' ? [] : rightHalf.split(':');
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return undefined;

  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => '0'),
    ...right,
  ].map((group) => Number.parseInt(group, 16));
  if (
    groups.length !== 8 ||
    groups.some(
      (group) => !Number.isInteger(group) || group < 0 || group > 0xffff,
    )
  ) {
    return undefined;
  }

  return Uint8Array.from(
    groups.flatMap((group) => [group >>> 8, group & 0xff]),
  );
}

function isUnsafeIpAddress(address: string): boolean {
  const [normalized = ''] = address
    .replace(/^\[|\]$/g, '')
    .split('%', 1);
  if (isUnsafeIpv4(normalized)) return true;

  const bytes = parseIpv6(normalized);
  if (bytes === undefined) return false;
  const allZero = bytes.every((byte) => byte === 0);
  const loopback =
    bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  const firstByte = bytes[0] ?? -1;
  const secondByte = bytes[1] ?? -1;
  const linkLocal = firstByte === 0xfe && (secondByte & 0xc0) === 0x80;
  const uniqueLocal = (firstByte & 0xfe) === 0xfc;
  const multicast = bytes[0] === 0xff;
  const mappedIpv4 =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  const compatibleIpv4 = bytes.slice(0, 12).every((byte) => byte === 0);
  const embeddedIpv4 = Array.from(bytes.slice(12)).join('.');

  return (
    allZero ||
    loopback ||
    linkLocal ||
    uniqueLocal ||
    multicast ||
    ((mappedIpv4 || compatibleIpv4) && isUnsafeIpv4(embeddedIpv4))
  );
}

const defaultPaidHttpDnsResolver: PaidHttpDnsResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export async function assertPaidHttpUrlAllowed(
  url: string,
  policy: PaidHttpUrlPolicy = {},
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new TypeError('Invalid paid HTTP URL', { cause: error });
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new TypeError('Paid HTTP URL must use HTTP or HTTPS');
  }

  const explicitlyAllowed = policy.allowHttpOrigins?.some((origin) => {
    try {
      return new URL(origin).origin === parsed.origin;
    } catch {
      return false;
    }
  });
  if (explicitlyAllowed) return;

  if (parsed.protocol !== 'https:') {
    throw new TypeError('Paid HTTP URL must use HTTPS');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  const resolved =
    isIP(hostname) === 0
      ? await (policy.resolveHostname ?? defaultPaidHttpDnsResolver)(hostname)
      : [hostname];
  if (resolved.length === 0) {
    throw new TypeError('Paid HTTP hostname resolved to no addresses');
  }
  for (const result of resolved) {
    const address = typeof result === 'string' ? result : result.address;
    const [addressWithoutZone = ''] = address.split('%', 1);
    if (isIP(addressWithoutZone) === 0 || isUnsafeIpAddress(address)) {
      throw new TypeError(
        `Paid HTTP URL resolved to a disallowed address: ${address}`,
      );
    }
  }
}

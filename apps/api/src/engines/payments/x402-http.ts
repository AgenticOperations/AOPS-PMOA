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

function bodyLimitError(): RangeError {
  return new RangeError('Paid HTTP body exceeds the 256 KiB decoded limit');
}

class BoundedUtf8Writer {
  readonly #buffer = new Uint8Array(MAX_PAID_HTTP_BODY_BYTES);
  readonly #encoder = new TextEncoder();
  #offset = 0;

  append(value: string): void {
    if (value.length > MAX_PAID_HTTP_BODY_BYTES - this.#offset) {
      throw bodyLimitError();
    }
    const result = this.#encoder.encodeInto(
      value,
      this.#buffer.subarray(this.#offset),
    );
    if (result.read !== value.length) throw bodyLimitError();
    this.#offset += result.written;
  }

  toBytes(): Uint8Array {
    return this.#buffer.slice(0, this.#offset);
  }
}

function appendJsonString(writer: BoundedUtf8Writer, value: string): void {
  writer.append('"');
  for (const character of value) {
    switch (character) {
      case '"':
        writer.append('\\"');
        break;
      case '\\':
        writer.append('\\\\');
        break;
      case '\b':
        writer.append('\\b');
        break;
      case '\f':
        writer.append('\\f');
        break;
      case '\n':
        writer.append('\\n');
        break;
      case '\r':
        writer.append('\\r');
        break;
      case '\t':
        writer.append('\\t');
        break;
      default: {
        const codePoint = character.codePointAt(0) ?? 0;
        if (codePoint <= 0x1f || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
          writer.append(`\\u${codePoint.toString(16).padStart(4, '0')}`);
        } else {
          writer.append(character);
        }
      }
    }
  }
  writer.append('"');
}

function stableJsonBytes(value: unknown): Uint8Array {
  const writer = new BoundedUtf8Writer();
  const ancestors = new Set<object>();

  function prepare(current: unknown, key: string): unknown {
    const toJson = (
      current as { readonly toJSON?: (propertyKey: string) => unknown }
    )?.toJSON;
    if (
      current !== null &&
      typeof current === 'object' &&
      typeof toJson === 'function'
    ) {
      return toJson.call(current, key);
    }
    return current;
  }

  function isOmitted(current: unknown): boolean {
    return (
      current === undefined ||
      typeof current === 'function' ||
      typeof current === 'symbol'
    );
  }

  function serializePrepared(current: unknown): void {
    if (current === null) {
      writer.append('null');
      return;
    }
    if (typeof current === 'string') {
      appendJsonString(writer, current);
      return;
    }
    if (typeof current === 'boolean') {
      writer.append(current ? 'true' : 'false');
      return;
    }
    if (typeof current === 'number') {
      writer.append(Number.isFinite(current) ? String(current) : 'null');
      return;
    }
    if (typeof current === 'bigint') {
      throw new TypeError('JSON body cannot contain bigint values');
    }
    if (isOmitted(current)) return;
    if (typeof current !== 'object') return;

    if (ancestors.has(current)) {
      throw new TypeError('JSON body cannot contain circular references');
    }
    ancestors.add(current);

    try {
      if (Array.isArray(current)) {
        writer.append('[');
        for (let index = 0; index < current.length; index += 1) {
          if (index > 0) writer.append(',');
          const prepared = prepare(current[index], String(index));
          if (isOmitted(prepared)) writer.append('null');
          else serializePrepared(prepared);
        }
        writer.append(']');
        return;
      }

      writer.append('{');
      let writtenProperties = 0;
      for (const entryKey of Object.keys(current).sort()) {
        const prepared = prepare(
          (current as Record<string, unknown>)[entryKey],
          entryKey,
        );
        if (isOmitted(prepared)) continue;
        if (writtenProperties > 0) writer.append(',');
        appendJsonString(writer, entryKey);
        writer.append(':');
        serializePrepared(prepared);
        writtenProperties += 1;
      }
      writer.append('}');
    } finally {
      ancestors.delete(current);
    }
  }

  const prepared = prepare(value, '');
  if (isOmitted(prepared)) {
    throw new TypeError('JSON body must be serializable');
  }
  serializePrepared(prepared);
  return writer.toBytes();
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
      bytes = stableJsonBytes(body.value);
      break;
    case 'text': {
      if (body.value.length > MAX_PAID_HTTP_BODY_BYTES) {
        throw bodyLimitError();
      }
      const writer = new BoundedUtf8Writer();
      writer.append(body.value);
      bytes = writer.toBytes();
      break;
    }
    case 'base64': {
      const maxEncodedLength = Math.ceil(MAX_PAID_HTTP_BODY_BYTES / 3) * 4;
      if (body.value.length > maxEncodedLength) {
        throw bodyLimitError();
      }
      if (
        !/^[A-Za-z0-9+/]*={0,2}$/.test(body.value) ||
        body.value.replace(/=+$/, '').length % 4 === 1 ||
        (body.value.includes('=') && body.value.length % 4 !== 0)
      ) {
        throw new TypeError('Invalid base64 paid HTTP body');
      }
      const padding = body.value.endsWith('==')
        ? 2
        : body.value.endsWith('=')
          ? 1
          : 0;
      const decodedLength = Math.floor((body.value.length * 3) / 4) - padding;
      if (decodedLength > MAX_PAID_HTTP_BODY_BYTES) {
        throw bodyLimitError();
      }
      const unpadded = body.value.replace(/=+$/, '');
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
    throw bodyLimitError();
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

export type ValidatedPaidHttpDestination = {
  readonly url: string;
  readonly hostname: string;
  readonly addresses: readonly string[];
  readonly resolveHostname: PaidHttpDnsResolver;
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
  const [first, second, third] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
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
  const globalUnicast = (firstByte & 0xe0) === 0x20;
  const documentation =
    (bytes[0] === 0x20 &&
      bytes[1] === 0x01 &&
      bytes[2] === 0x0d &&
      bytes[3] === 0xb8) ||
    (bytes[0] === 0x3f &&
      bytes[1] === 0xff &&
      ((bytes[2] ?? 0) & 0xf0) === 0x00);
  const benchmarking =
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x00 &&
    bytes[3] === 0x02 &&
    bytes[4] === 0x00 &&
    bytes[5] === 0x00;
  const transitionOrOverlay =
    (bytes[0] === 0x20 && bytes[1] === 0x02) ||
    (bytes[0] === 0x20 &&
      bytes[1] === 0x01 &&
      bytes[2] === 0x00 &&
      bytes[3] === 0x00) ||
    (bytes[0] === 0x20 &&
      bytes[1] === 0x01 &&
      ((bytes[2] ?? 0) & 0xf0) === 0x10) ||
    (bytes[0] === 0x20 &&
      bytes[1] === 0x01 &&
      ((bytes[2] ?? 0) & 0xf0) === 0x20);

  if (mappedIpv4) return isUnsafeIpv4(embeddedIpv4);

  return (
    allZero ||
    loopback ||
    linkLocal ||
    uniqueLocal ||
    multicast ||
    compatibleIpv4 ||
    !globalUnicast ||
    documentation ||
    benchmarking ||
    transitionOrOverlay
  );
}

const defaultPaidHttpDnsResolver: PaidHttpDnsResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export async function assertPaidHttpUrlAllowed(
  url: string,
  policy: PaidHttpUrlPolicy = {},
): Promise<ValidatedPaidHttpDestination> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new TypeError('Invalid paid HTTP URL', { cause: error });
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new TypeError('Paid HTTP URL must use HTTP or HTTPS');
  }

  const explicitlyAllowed =
    parsed.protocol === 'http:' &&
    policy.allowHttpOrigins?.some((origin) => {
      try {
        return new URL(origin).origin === parsed.origin;
      } catch {
        return false;
      }
    });
  if (parsed.protocol !== 'https:' && !explicitlyAllowed) {
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
  const resolvedAddresses = resolved.map((result) =>
    typeof result === 'string' ? result : result.address,
  );
  for (const address of resolvedAddresses) {
    const [addressWithoutZone = ''] = address.split('%', 1);
    if (
      isIP(addressWithoutZone) === 0 ||
      (!explicitlyAllowed && isUnsafeIpAddress(address))
    ) {
      throw new TypeError(
        `Paid HTTP URL resolved to a disallowed address: ${address}`,
      );
    }
  }

  const addresses = Object.freeze(resolvedAddresses);
  const resolveHostname: PaidHttpDnsResolver = (requestedHostname) => {
    if (requestedHostname !== hostname) {
      return Promise.reject(
        new TypeError(
          `Pinned paid HTTP destination cannot resolve: ${requestedHostname}`,
        ),
      );
    }
    return Promise.resolve(addresses);
  };

  return Object.freeze({
    url: parsed.href,
    hostname,
    addresses,
    resolveHostname,
  });
}

import { createHash, type Hash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import {
  request as requestHttp,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions,
} from 'node:http';
import { request as requestHttps } from 'node:https';
import { isIP } from 'node:net';

import { decodePaymentRequiredHeader } from '@x402/core/http';
import type { PaymentRequired } from '@x402/core/types';

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
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'keep-alive',
  'accept-encoding',
  'payment-signature',
  'payment-response',
  'payment-required',
  'x-payment',
]);
const PAID_HTTP_HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

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
  for (const [name, value] of request.headers) {
    if (typeof name !== 'string' || !PAID_HTTP_HEADER_NAME.test(name)) {
      throw new TypeError(`Invalid paid HTTP header name: ${String(name)}`);
    }
    if (typeof value !== 'string' || /[\r\n\0]/.test(value)) {
      throw new TypeError(`Invalid paid HTTP header value for: ${name}`);
    }
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

export type SerializedPaidHttpDestination = Pick<
  ValidatedPaidHttpDestination,
  'url' | 'hostname' | 'addresses'
>;

export function serializePaidHttpDestination(
  destination: ValidatedPaidHttpDestination,
): SerializedPaidHttpDestination {
  return {
    url: destination.url,
    hostname: destination.hostname,
    addresses: [...destination.addresses],
  };
}

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

export const DEFAULT_PAID_HTTP_RESPONSE_BYTES = 1024 * 1024;
export const DEFAULT_PAID_HTTP_TIMEOUT_MS = 15_000;
export const PAID_HTTP_PAYMENT_TIMEOUT_MS = 30_000;

export type PaidHttpResponse = {
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
  readonly contentType: string | undefined;
  readonly bodyEncoding: 'json' | 'text' | 'base64';
  readonly body: unknown;
  readonly sizeBytes: number;
  readonly truncated: false;
};

export type PaidHttpErrorCode =
  | 'not_payment_required'
  | 'payment_required_missing'
  | 'payment_required_invalid'
  | 'payment_required_empty_accepts'
  | 'redirect_not_supported'
  | 'request_timeout'
  | 'response_too_large'
  | 'unsupported_content_encoding'
  | 'invalid_json'
  | 'invalid_destination'
  | 'request_failed';

export class PaidHttpError extends Error {
  override readonly name = 'PaidHttpError';

  constructor(
    readonly code: PaidHttpErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const MAX_SERIALIZED_PAID_HTTP_ADDRESSES = 16;
const MAX_SERIALIZED_PAID_HTTP_URL_LENGTH = 4096;

function invalidSerializedPaidHttpDestination(): PaidHttpError {
  return new PaidHttpError(
    'invalid_destination',
    'Serialized paid HTTP destination is invalid',
  );
}

function isSerializedPaidHttpAddressList(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_SERIALIZED_PAID_HTTP_ADDRESSES &&
    value.every((address: unknown) => typeof address === 'string' && isIP(address) !== 0);
}

/**
 * Reconstructs an authenticated destination capability after worker transport.
 * This validates the serialized shape and pin consistency only; it deliberately
 * does not repeat URL allowlist checks or DNS resolution performed upstream.
 */
export function rehydratePaidHttpDestination(
  value: unknown,
): ValidatedPaidHttpDestination {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidSerializedPaidHttpDestination();
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidSerializedPaidHttpDestination();
  }
  const keys = Object.keys(value);
  const expectedKeys = new Set(['addresses', 'hostname', 'url']);
  if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) {
    throw invalidSerializedPaidHttpDestination();
  }

  const destination = value as Record<string, unknown>;
  if (
    typeof destination.url !== 'string' ||
    destination.url.length === 0 ||
    destination.url.length > MAX_SERIALIZED_PAID_HTTP_URL_LENGTH ||
    typeof destination.hostname !== 'string' ||
    destination.hostname.length === 0 ||
    destination.hostname.length > 253 ||
    !isSerializedPaidHttpAddressList(destination.addresses)
  ) {
    throw invalidSerializedPaidHttpDestination();
  }

  let parsed: URL;
  try {
    parsed = new URL(destination.url);
  } catch {
    throw invalidSerializedPaidHttpDestination();
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.hostname.replace(/^\[|\]$/g, '') !== destination.hostname
  ) {
    throw invalidSerializedPaidHttpDestination();
  }

  const hostname = destination.hostname;
  const url = destination.url;
  const addresses = Object.freeze([...destination.addresses]);
  const resolveHostname: PaidHttpDnsResolver = (requestedHostname) => {
    if (requestedHostname !== hostname) {
      return Promise.reject(new PaidHttpError(
        'invalid_destination',
        'Paid HTTP resolver hostname does not match the authenticated destination',
      ));
    }
    return Promise.resolve(addresses);
  };
  return Object.freeze({ addresses, hostname, resolveHostname, url });
}

export type PaidHttpExecutionOptions = {
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly requestConnector?: PaidHttpRequestConnector;
};

export type PaidHttpRequestConnector = (
  url: URL,
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => ClientRequest;

const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function safeResponseHeaders(
  rawHeaders: readonly string[],
): readonly (readonly [string, string])[] {
  const connectionHeaders = new Set<string>();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() !== 'connection') continue;
    for (const name of (rawHeaders[index + 1] ?? '').split(',')) {
      const normalized = name.trim().toLowerCase();
      if (normalized !== '') connectionHeaders.add(normalized);
    }
  }

  const headers: (readonly [string, string])[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (name === undefined || value === undefined) continue;
    const normalized = name.toLowerCase();
    if (
      HOP_BY_HOP_RESPONSE_HEADERS.has(normalized) ||
      connectionHeaders.has(normalized)
    ) {
      continue;
    }
    headers.push([name, value]);
  }
  return headers;
}

function firstHeader(
  headers: readonly (readonly [string, string])[],
  searchedName: string,
): string | undefined {
  const normalizedSearchedName = searchedName.toLowerCase();
  return headers.find(
    ([name]) => name.toLowerCase() === normalizedSearchedName,
  )?.[1];
}

function hasUnsupportedContentEncoding(
  headers: readonly (readonly [string, string])[],
): boolean {
  return headers
    .filter(([name]) => name.toLowerCase() === 'content-encoding')
    .some(([, value]) =>
      value
        .split(',')
        .some((encoding) => encoding.trim().toLowerCase() !== 'identity'),
    );
}

function decodeResponseBody(
  bytes: Buffer,
  contentType: string | undefined,
): Pick<PaidHttpResponse, 'body' | 'bodyEncoding'> {
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const json =
    mediaType === 'application/json' ||
    (mediaType.startsWith('application/') && mediaType.endsWith('+json'));
  if (json) {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return { bodyEncoding: 'json', body: JSON.parse(text) as unknown };
    } catch (error) {
      throw new PaidHttpError(
        'invalid_json',
        'Paid HTTP response declared JSON but was not valid UTF-8 JSON',
        { cause: error },
      );
    }
  }

  const text =
    mediaType.startsWith('text/') ||
    mediaType === 'application/javascript' ||
    mediaType === 'application/x-www-form-urlencoded' ||
    mediaType === 'application/xml' ||
    mediaType === 'application/xhtml+xml' ||
    mediaType.endsWith('+xml');
  if (text) {
    try {
      return {
        bodyEncoding: 'text',
        body: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      };
    } catch {
      // Invalid UTF-8 is returned losslessly as binary below.
    }
  }

  return { bodyEncoding: 'base64', body: bytes.toString('base64') };
}

function pinnedLookup(
  destination: ValidatedPaidHttpDestination,
): NonNullable<RequestOptions['lookup']> {
  const validatedAddresses = new Set(destination.addresses);

  return (hostname, options, callback) => {
    const requestedHostname = hostname.replace(/^\[|\]$/g, '');
    if (requestedHostname !== destination.hostname) {
      callback(
        new PaidHttpError(
          'invalid_destination',
          `Paid HTTP connector attempted to resolve an unvalidated hostname: ${hostname}`,
        ),
        '',
        0,
      );
      return;
    }

    void destination
      .resolveHostname(requestedHostname)
      .then((resolved) => {
        const addresses = resolved.map((entry) =>
          typeof entry === 'string' ? entry : entry.address,
        );
        if (
          addresses.length === 0 ||
          addresses.some(
            (address) =>
              isIP(address.replace(/^\[|\]$/g, '').split('%', 1)[0] ?? '') ===
                0 || !validatedAddresses.has(address),
          )
        ) {
          throw new PaidHttpError(
            'invalid_destination',
            'Pinned paid HTTP resolver returned an unvalidated address',
          );
        }

        const lookupOptions =
          typeof options === 'number' ? { family: options } : options;
        const candidates = addresses
          .map((address) => ({
            address,
            family: isIP(
              address.replace(/^\[|\]$/g, '').split('%', 1)[0] ?? '',
            ) as 4 | 6,
          }))
          .filter(
            ({ family }) =>
              lookupOptions.family === undefined ||
              lookupOptions.family === 0 ||
              lookupOptions.family === family,
          );
        if (candidates.length === 0) {
          throw new PaidHttpError(
            'invalid_destination',
            'Pinned paid HTTP destination has no address for the requested family',
          );
        }

        if (lookupOptions.all) callback(null, candidates);
        else {
          const [candidate] = candidates;
          if (candidate === undefined) return;
          callback(null, candidate.address, candidate.family);
        }
      })
      .catch((error: unknown) => {
        callback(
          error instanceof Error
            ? error
            : new PaidHttpError(
                'invalid_destination',
                'Pinned paid HTTP resolution failed',
                { cause: error },
              ),
          '',
          0,
        );
      });
  };
}

const defaultPaidHttpRequestConnector: PaidHttpRequestConnector = (
  url,
  options,
  onResponse,
) =>
  (url.protocol === 'https:' ? requestHttps : requestHttp)(
    url,
    options,
    onResponse,
  );

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return selected;
}

export function executeBoundedHttpRequest(
  request: NormalizedPaidHttpRequest,
  destination: ValidatedPaidHttpDestination,
  options: PaidHttpExecutionOptions = {},
): Promise<PaidHttpResponse> {
  const parsedUrl = new URL(request.url);
  if (
    parsedUrl.href !== new URL(destination.url).href ||
    parsedUrl.hostname.replace(/^\[|\]$/g, '') !== destination.hostname ||
    destination.addresses.length === 0
  ) {
    return Promise.reject(
      new PaidHttpError(
        'invalid_destination',
        'Paid HTTP request does not match its validated pinned destination',
      ),
    );
  }

  const timeoutMs = boundedPositiveInteger(
    options.timeoutMs,
    DEFAULT_PAID_HTTP_TIMEOUT_MS,
    'Paid HTTP timeout',
  );
  const maxResponseBytes = boundedPositiveInteger(
    options.maxResponseBytes,
    DEFAULT_PAID_HTTP_RESPONSE_BYTES,
    'Paid HTTP response byte limit',
  );
  const rawRequestHeaders = request.headers.flatMap(([name, value]) => [
    name,
    value,
  ]);
  rawRequestHeaders.push('Host', parsedUrl.host);
  rawRequestHeaders.push('Accept-Encoding', 'identity');
  if (request.body !== undefined) {
    rawRequestHeaders.push('Content-Length', String(request.body.byteLength));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let clientRequest: ClientRequest | undefined;
    let incomingResponse: IncomingMessage | undefined;
    const timer = setTimeout(() => {
      fail(
        new PaidHttpError(
          'request_timeout',
          `Paid HTTP request exceeded its ${timeoutMs} ms timeout`,
        ),
      );
    }, timeoutMs);

    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      incomingResponse?.destroy(error);
      clientRequest?.destroy(error);
      reject(error);
    }

    function succeed(response: PaidHttpResponse): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    }

    try {
      clientRequest = (
        options.requestConnector ?? defaultPaidHttpRequestConnector
      )(
        parsedUrl,
        {
          agent: false,
          method: request.method,
          headers: rawRequestHeaders,
          lookup: pinnedLookup(destination),
          ...(parsedUrl.protocol === 'https:' && isIP(destination.hostname) === 0
            ? { servername: destination.hostname }
            : {}),
        },
        (response) => {
          incomingResponse = response;
          const status = response.statusCode ?? 0;
          const headers = safeResponseHeaders(response.rawHeaders);
          if (hasUnsupportedContentEncoding(headers)) {
            fail(
              new PaidHttpError(
                'unsupported_content_encoding',
                'Paid HTTP response content encoding is not supported',
              ),
            );
            return;
          }
          if (
            status >= 300 &&
            status < 400 &&
            firstHeader(headers, 'location') !== undefined
          ) {
            fail(
              new PaidHttpError(
                'redirect_not_supported',
                'Paid HTTP redirects are not supported',
              ),
            );
            return;
          }

          const chunks: Buffer[] = [];
          let sizeBytes = 0;
          response.on('data', (chunk: Buffer | Uint8Array | string) => {
            if (settled) return;
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            sizeBytes += bytes.byteLength;
            if (sizeBytes > maxResponseBytes) {
              fail(
                new PaidHttpError(
                  'response_too_large',
                  `Paid HTTP response exceeded ${maxResponseBytes} bytes`,
                ),
              );
              return;
            }
            chunks.push(bytes);
          });
          response.once('error', (error) => {
            if (!settled) {
              fail(
                error instanceof PaidHttpError
                  ? error
                  : new PaidHttpError(
                      'request_failed',
                      'Paid HTTP response stream failed',
                      { cause: error },
                    ),
              );
            }
          });
          response.once('end', () => {
            if (settled) return;
            try {
              const contentType = firstHeader(headers, 'content-type');
              const decoded = decodeResponseBody(
                Buffer.concat(chunks, sizeBytes),
                contentType,
              );
              succeed({
                status,
                headers,
                contentType,
                ...decoded,
                sizeBytes,
                truncated: false,
              });
            } catch (error) {
              fail(
                error instanceof Error
                  ? error
                  : new PaidHttpError(
                      'request_failed',
                      'Paid HTTP response decoding failed',
                      { cause: error },
                    ),
              );
            }
          });
        },
      );
      clientRequest.once('error', (error) => {
        if (settled) return;
        fail(
          error instanceof PaidHttpError
            ? error
            : new PaidHttpError(
                'request_failed',
                'Paid HTTP request failed',
                { cause: error },
              ),
        );
      });
      if (request.body !== undefined) clientRequest.write(request.body);
      clientRequest.end();
    } catch (error) {
      fail(
        error instanceof PaidHttpError
          ? error
          : new PaidHttpError(
              'request_failed',
              'Paid HTTP request construction failed',
              {
                cause: error,
              },
            ),
      );
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validatedPaymentRequired(value: unknown): PaymentRequired {
  if (!isRecord(value) || value.x402Version !== 2 || !isRecord(value.resource)) {
    throw new PaidHttpError(
      'payment_required_invalid',
      'Payment-required quote is invalid',
    );
  }
  if (!Array.isArray(value.accepts)) {
    throw new PaidHttpError(
      'payment_required_invalid',
      'Payment-required quote is invalid',
    );
  }
  if (value.accepts.length === 0) {
    throw new PaidHttpError(
      'payment_required_empty_accepts',
      'Payment-required quote has no accepted payment options',
    );
  }
  if (
    !isNonemptyString(value.resource.url) ||
    value.accepts.some(
      (requirements) =>
        !isRecord(requirements) ||
        !isNonemptyString(requirements.scheme) ||
        !isNonemptyString(requirements.network) ||
        !isNonemptyString(requirements.asset) ||
        !isNonemptyString(requirements.amount) ||
        !isNonemptyString(requirements.payTo) ||
        typeof requirements.maxTimeoutSeconds !== 'number' ||
        !Number.isFinite(requirements.maxTimeoutSeconds) ||
        requirements.maxTimeoutSeconds < 0 ||
        !isRecord(requirements.extra),
    )
  ) {
    throw new PaidHttpError(
      'payment_required_invalid',
      'Payment-required quote is invalid',
    );
  }
  return value as PaymentRequired;
}

export function paymentRequiredFromResponse(
  response: PaidHttpResponse,
): PaymentRequired {
  if (response.status !== 402) {
    throw new PaidHttpError(
      'not_payment_required',
      `Expected HTTP 402 payment required, received ${response.status}`,
    );
  }

  const encodedHeader = firstHeader(response.headers, 'payment-required');
  if (encodedHeader !== undefined) {
    let decoded: unknown;
    try {
      decoded = decodePaymentRequiredHeader(encodedHeader);
    } catch (error) {
      throw new PaidHttpError(
        'payment_required_invalid',
        'PAYMENT-REQUIRED header is invalid',
        { cause: error },
      );
    }
    return validatedPaymentRequired(decoded);
  }

  if (response.bodyEncoding !== 'json') {
    throw new PaidHttpError(
      'payment_required_missing',
      'HTTP 402 response did not include a payment-required quote',
    );
  }
  return validatedPaymentRequired(response.body);
}

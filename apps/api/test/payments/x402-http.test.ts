import {
  createServer,
  request as requestHttp,
  type RequestListener,
  type Server,
} from "node:http";
import {
  createServer as createHttpsServer,
  request as requestHttps,
  type RequestOptions,
} from "node:https";
import type { TLSSocket } from "node:tls";

import { encodePaymentRequiredHeader } from "@x402/core/http";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertPaidHttpUrlAllowed,
  canonicalPaidHttpRequestHash,
  executeBoundedHttpRequest,
  normalizePaidHttpRequest,
  paymentRequiredFromResponse,
  type PaidHttpResponse,
} from "../../src/engines/payments/x402-http.js";

const openServers = new Set<Server>();

afterEach(async () => {
  await Promise.all(
    Array.from(openServers, (server) =>
      new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  openServers.clear();
});

async function startHttpServer(
  handler: RequestListener,
): Promise<{ readonly origin: string; readonly port: number }> {
  const server = createServer(handler);
  openServers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test HTTP server did not bind to TCP");
  }
  return {
    origin: `http://merchant.test:${address.port}`,
    port: address.port,
  };
}

async function executeLocalHttp(
  handler: RequestListener,
  options: { readonly timeoutMs?: number; readonly maxResponseBytes?: number } = {},
) {
  const { origin } = await startHttpServer(handler);
  const url = `${origin}/paid?a=1&a=2`;
  const destination = await assertPaidHttpUrlAllowed(url, {
    allowHttpOrigins: [origin],
    resolveHostname: () => Promise.resolve(["127.0.0.1"]),
  });
  return executeBoundedHttpRequest(
    normalizePaidHttpRequest({ url, method: "GET", headers: [] }),
    destination,
    options,
  );
}

const validPaymentRequired = {
  x402Version: 2,
  resource: {
    url: "https://merchant.test/paid",
    description: "Test resource",
    mimeType: "application/json",
  },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453" as `${string}:${string}`,
      asset: "0x0000000000000000000000000000000000000001",
      amount: "1000",
      payTo: "0x0000000000000000000000000000000000000002",
      maxTimeoutSeconds: 60,
      extra: {},
    },
  ],
};

const TLS_KEY = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIPpDbYk0sgAw6D6GkesVzGFUt7cO9oq/PqW6yxp9AKZWoAoGCCqGSM49
AwEHoUQDQgAEpuUaBsC2zyV3ScxVwNLw8LfBHhQFOkJx8BLkXjcaco5BjClNk1oZ
p74EaN309NNFXFjayQNVqkMVfZTYq9q/Eg==
-----END EC PRIVATE KEY-----`;

const TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIBojCCAUegAwIBAgIUZBQESGrH6klS9i6gCjWbLqSQbGswCgYIKoZIzj0EAwIw
GDEWMBQGA1UEAwwNbWVyY2hhbnQudGVzdDAgFw0yNjA3MTMxMTA1MTJaGA8yMTI2
MDYxOTExMDUxMlowGDEWMBQGA1UEAwwNbWVyY2hhbnQudGVzdDBZMBMGByqGSM49
AgEGCCqGSM49AwEHA0IABKblGgbAts8ld0nMVcDS8PC3wR4UBTpCcfAS5F43GnKO
QYwpTZNaGae+BGjd9PTTRVxY2skDVapDFX2U2KvavxKjbTBrMB0GA1UdDgQWBBRa
8UOuvWYZ2TNk3NATq9DNT7J4ijAfBgNVHSMEGDAWgBRa8UOuvWYZ2TNk3NATq9DN
T7J4ijAYBgNVHREEETAPgg1tZXJjaGFudC50ZXN0MA8GA1UdEwEB/wQFMAMBAf8w
CgYIKoZIzj0EAwIDSQAwRgIhAPbWpmEP3DZ8Bs4dohi5gpBB404hUuSGNnskgtpC
azWjAiEAsLKNkAjnjHiHpWlgqTDo/1AnTzJQNqHQeQUi/4XeqOQ=
-----END CERTIFICATE-----`;

function responseForDiscovery(
  overrides: Partial<PaidHttpResponse> = {},
): PaidHttpResponse {
  return {
    status: 402,
    headers: [],
    contentType: "application/json",
    bodyEncoding: "json",
    body: validPaymentRequired,
    sizeBytes: 1,
    truncated: false,
    ...overrides,
  };
}

describe("normalizePaidHttpRequest", () => {
  it("preserves repeated and encoded query parameters", () => {
    const normalized = normalizePaidHttpRequest({
      url: "https://example.com/pay?a=1&a=2&encoded=%2Fvalue%20here",
      method: "GET",
      headers: [],
    });

    expect(normalized.url).toBe(
      "https://example.com/pay?a=1&a=2&encoded=%2Fvalue%20here",
    );
  });

  it("encodes JSON deterministically regardless of object key order", () => {
    const first = normalizePaidHttpRequest({
      url: "https://example.com/pay",
      method: "POST",
      headers: [],
      body: { kind: "json", value: { z: 1, nested: { b: 2, a: 1 } } },
    });
    const second = normalizePaidHttpRequest({
      url: "https://example.com/pay",
      method: "POST",
      headers: [],
      body: { kind: "json", value: { nested: { a: 1, b: 2 }, z: 1 } },
    });

    expect(new TextDecoder().decode(first.body)).toBe(
      '{"nested":{"a":1,"b":2},"z":1}',
    );
    expect(first.body).toEqual(second.body);
  });

  it("serializes sparse and undefined array entries as JSON null", () => {
    const sparse: unknown[] = [];
    sparse[1] = 1;

    const normalized = normalizePaidHttpRequest({
      url: "https://example.com/pay",
      method: "POST",
      headers: [],
      body: {
        kind: "json",
        value: { sparse, explicit: [undefined, 1] },
      },
    });

    expect(new TextDecoder().decode(normalized.body)).toBe(
      '{"explicit":[null,1],"sparse":[null,1]}',
    );
  });

  it("encodes text as UTF-8 and decodes base64 bodies", () => {
    const text = normalizePaidHttpRequest({
      url: "https://example.com/pay",
      method: "POST",
      headers: [],
      body: { kind: "text", value: "paid ✓" },
    });
    const base64 = normalizePaidHttpRequest({
      url: "https://example.com/pay",
      method: "POST",
      headers: [],
      body: { kind: "base64", value: "AAH/" },
    });

    expect(Array.from(text.body ?? [])).toEqual(
      Array.from(new TextEncoder().encode("paid ✓")),
    );
    expect(Array.from(base64.body ?? [])).toEqual([0, 1, 255]);
  });

  it.each(["PUT", "PATCH", "DELETE"] as const)(
    "normalizes %s requests with bodies",
    (method) => {
      const normalized = normalizePaidHttpRequest({
        url: "https://example.com/pay",
        method,
        headers: [["Content-Type", "text/plain"]],
        body: { kind: "text", value: `payload-${method}` },
      });

      expect(normalized.method).toBe(method);
      expect(new TextDecoder().decode(normalized.body)).toBe(
        `payload-${method}`,
      );
    },
  );

  it("rejects invalid URLs, methods, encodings, and GET bodies", () => {
    expect(() =>
      normalizePaidHttpRequest({
        url: "not a URL",
        method: "POST",
        headers: [],
      }),
    ).toThrow(/URL/i);
    expect(() =>
      normalizePaidHttpRequest({
        url: "https://example.com/pay",
        method: "OPTIONS" as never,
        headers: [],
      }),
    ).toThrow(/method/i);
    expect(() =>
      normalizePaidHttpRequest({
        url: "https://example.com/pay",
        method: "POST",
        headers: [],
        body: { kind: "form", value: "a=1" } as never,
      }),
    ).toThrow(/encoding/i);
    expect(() =>
      normalizePaidHttpRequest({
        url: "https://example.com/pay",
        method: "GET",
        headers: [],
        body: { kind: "text", value: "not allowed" },
      }),
    ).toThrow(/GET/i);
  });

  it("enforces a 256 KiB decoded body limit", () => {
    const atLimit = normalizePaidHttpRequest({
      url: "https://example.com/pay",
      method: "POST",
      headers: [],
      body: { kind: "text", value: "a".repeat(256 * 1024) },
    });
    expect(atLimit.body).toHaveLength(256 * 1024);

    expect(() =>
      normalizePaidHttpRequest({
        url: "https://example.com/pay",
        method: "POST",
        headers: [],
        body: { kind: "base64", value: Buffer.alloc(256 * 1024 + 1).toString("base64") },
      }),
    ).toThrow(/256 KiB/i);
  });

  it("rejects oversized text before allocating encoded bytes", () => {
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    try {
      expect(() =>
        normalizePaidHttpRequest({
          url: "https://example.com/pay",
          method: "POST",
          headers: [],
          body: { kind: "text", value: "a".repeat(256 * 1024 + 1) },
        }),
      ).toThrow(/256 KiB/i);
      expect(encode).not.toHaveBeenCalled();
    } finally {
      encode.mockRestore();
    }
  });

  it("rejects oversized base64 before invoking the decoder", () => {
    const encoded = "AAAA".repeat(Math.floor((256 * 1024) / 3) + 1);
    const decode = vi.spyOn(Buffer, "from").mockImplementation(() => {
      throw new Error("base64 decoder was called");
    });
    try {
      expect(() =>
        normalizePaidHttpRequest({
          url: "https://example.com/pay",
          method: "POST",
          headers: [],
          body: { kind: "base64", value: encoded },
        }),
      ).toThrow(/256 KiB/i);
      expect(decode).not.toHaveBeenCalled();
    } finally {
      decode.mockRestore();
    }
  });

  it("aborts canonical JSON serialization as soon as the byte limit is exceeded", () => {
    const chunks = Array.from({ length: 300 }, () => "x".repeat(1024));
    Object.defineProperty(chunks, 299, {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("serializer read beyond the bounded output");
      },
    });

    expect(() =>
      normalizePaidHttpRequest({
        url: "https://example.com/pay",
        method: "POST",
        headers: [],
        body: { kind: "json", value: chunks },
      }),
    ).toThrow(/256 KiB/i);
  });

  it("preserves ordered allowed headers and rejects denied headers case-insensitively", () => {
    const headers = [
      ["X-First", "1"],
      ["x-first", "2"],
      ["Accept", "application/json"],
    ] as const;
    expect(
      normalizePaidHttpRequest({
        url: "https://example.com/pay",
        method: "POST",
        headers,
      }).headers,
    ).toEqual(headers);

    for (const name of [
      "Host",
      "CONTENT-LENGTH",
      "Connection",
      "Transfer-Encoding",
      "Upgrade",
      "Proxy-Authorization",
      "proxy-anything",
      "Payment-Signature",
      "PAYMENT-RESPONSE",
      "Payment-Required",
      "X-Payment",
      "x-payment-signature",
      "X-PAYMENT-RESPONSE",
      "X-Payment-Required",
    ]) {
      expect(() =>
        normalizePaidHttpRequest({
          url: "https://example.com/pay",
          method: "POST",
          headers: [[name, "blocked"]],
        }),
      ).toThrow(/header/i);
    }
  });
});

describe("canonicalPaidHttpRequestHash", () => {
  it("is stable for equivalent JSON and header casing but changes with request meaning", () => {
    const first = canonicalPaidHttpRequestHash({
      url: "https://example.com/pay?a=1&a=2",
      method: "POST",
      headers: [
        ["Content-Type", "application/json"],
        ["X-Trace", "one"],
      ],
      body: { kind: "json", value: { b: 2, a: 1 } },
    });
    const equivalent = canonicalPaidHttpRequestHash({
      url: "https://example.com/pay?a=1&a=2",
      method: "POST",
      headers: [
        ["content-type", "application/json"],
        ["x-trace", "one"],
      ],
      body: { kind: "json", value: { a: 1, b: 2 } },
    });
    const changed = canonicalPaidHttpRequestHash({
      url: "https://example.com/pay?a=1&a=3",
      method: "POST",
      headers: [
        ["content-type", "application/json"],
        ["x-trace", "one"],
      ],
      body: { kind: "json", value: { a: 1, b: 2 } },
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(equivalent).toBe(first);
    expect(changed).not.toBe(first);
  });
});

describe("assertPaidHttpUrlAllowed", () => {
  it("applies allowHttpOrigins only to exact HTTP local-dev origins", async () => {
    await expect(
      assertPaidHttpUrlAllowed("https://127.0.0.1/pay", {
        allowHttpOrigins: ["https://127.0.0.1"],
      }),
    ).rejects.toThrow(/address/i);
    await expect(
      assertPaidHttpUrlAllowed("http://127.0.0.1/pay", {
        allowHttpOrigins: ["http://127.0.0.1"],
      }),
    ).resolves.toMatchObject({
      url: "http://127.0.0.1/pay",
      hostname: "127.0.0.1",
      addresses: ["127.0.0.1"],
    });
  });

  it("returns an immutable destination with a pinned checked resolver", async () => {
    const upstreamResolver = vi.fn(() =>
      Promise.resolve([
        { address: "93.184.216.34" },
        "2606:2800:220:1::1",
      ]),
    );

    const destination = await assertPaidHttpUrlAllowed(
      "https://merchant.example:443/pay?a=1&a=2",
      { resolveHostname: upstreamResolver },
    );

    expect(destination).toMatchObject({
      url: "https://merchant.example/pay?a=1&a=2",
      hostname: "merchant.example",
      addresses: ["93.184.216.34", "2606:2800:220:1::1"],
    });
    expect(Object.isFrozen(destination.addresses)).toBe(true);
    await expect(
      destination.resolveHostname("merchant.example"),
    ).resolves.toEqual(["93.184.216.34", "2606:2800:220:1::1"]);
    await expect(
      destination.resolveHostname("unvalidated.example"),
    ).rejects.toThrow(/pinned/i);
    expect(upstreamResolver).toHaveBeenCalledTimes(1);
  });

  it("snapshots each resolved address exactly once before validation", async () => {
    let reads = 0;
    const changingResult = {
      get address(): string {
        reads += 1;
        return reads === 1 ? "93.184.216.34" : "127.0.0.1";
      },
    };

    const destination = await assertPaidHttpUrlAllowed(
      "https://merchant.example/pay",
      { resolveHostname: () => Promise.resolve([changingResult]) },
    );

    expect(destination.addresses).toEqual(["93.184.216.34"]);
    expect(reads).toBe(1);
  });

  it("requires HTTPS unless the exact HTTP origin is allowed", async () => {
    const resolveHostname = () =>
      Promise.resolve(["93.184.216.34"] as const);

    await expect(
      assertPaidHttpUrlAllowed("http://example.com/pay", { resolveHostname }),
    ).rejects.toThrow(/HTTPS/i);
    await expect(
      assertPaidHttpUrlAllowed("http://localhost:8080/pay", {
        allowHttpOrigins: ["http://localhost:8080"],
        resolveHostname: () => Promise.resolve(["127.0.0.1"]),
      }),
    ).resolves.toMatchObject({ addresses: ["127.0.0.1"] });
    await expect(
      assertPaidHttpUrlAllowed("http://localhost:8081/pay", {
        allowHttpOrigins: ["http://localhost:8080"],
        resolveHostname,
      }),
    ).rejects.toThrow(/HTTPS/i);
  });

  it("rejects unsafe direct and DNS-resolved IPv4 and IPv6 addresses", async () => {
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.0.0.1",
      "192.0.2.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fec0::1",
      "fe80::1",
      "2001:db8::1",
      "ff02::1",
    ]) {
      await expect(
        assertPaidHttpUrlAllowed("https://merchant.example/pay", {
          resolveHostname: () => Promise.resolve([address]),
        }),
      ).rejects.toThrow(/address/i);
    }

    await expect(
      assertPaidHttpUrlAllowed("https://127.0.0.1/pay", {
        resolveHostname: () =>
          Promise.reject(new Error("IP literals should not use DNS")),
      }),
    ).rejects.toThrow(/address/i);
    await expect(
      assertPaidHttpUrlAllowed("https://merchant.example/pay", {
        resolveHostname: () =>
          Promise.resolve(["93.184.216.34", "2606:2800:220:1::1"]),
      }),
    ).resolves.toMatchObject({
      addresses: ["93.184.216.34", "2606:2800:220:1::1"],
    });
    await expect(
      assertPaidHttpUrlAllowed("https://merchant.example/pay", {
        resolveHostname: () => Promise.resolve(["3ff1::1"]),
      }),
    ).resolves.toMatchObject({ addresses: ["3ff1::1"] });
  });
});

describe("executeBoundedHttpRequest", () => {
  it("decodes JSON and preserves ordered safe response headers", async () => {
    const response = await executeLocalHttp((_request, outgoing) => {
      outgoing.writeHead(200, [
        "Content-Type",
        "application/problem+json; charset=utf-8",
        "X-First",
        "one",
        "Set-Cookie",
        "session=opaque; HttpOnly",
        "Set-Cookie",
        "preference=opaque; Secure",
        "Connection",
        "X-Hop",
        "X-Hop",
        "do-not-return",
      ]);
      outgoing.end('{"ok":true,"count":2}');
    });

    expect(response).toMatchObject({
      status: 200,
      contentType: "application/problem+json; charset=utf-8",
      bodyEncoding: "json",
      body: { ok: true, count: 2 },
      sizeBytes: 21,
      truncated: false,
    });
    expect(
      response.headers.filter(([name]) =>
        ["x-first", "set-cookie"].includes(name.toLowerCase()),
      ),
    ).toEqual([
      ["X-First", "one"],
      ["Set-Cookie", "session=opaque; HttpOnly"],
      ["Set-Cookie", "preference=opaque; Secure"],
    ]);
    expect(response.headers.map(([name]) => name.toLowerCase())).not.toContain(
      "connection",
    );
    expect(response.headers.map(([name]) => name.toLowerCase())).not.toContain(
      "x-hop",
    );
  });

  it("decodes valid UTF-8 text responses", async () => {
    const response = await executeLocalHttp((_request, outgoing) => {
      outgoing.setHeader("Content-Type", "text/plain; charset=utf-8");
      outgoing.end("paid ✓");
    });

    expect(response).toMatchObject({
      status: 200,
      bodyEncoding: "text",
      body: "paid ✓",
      sizeBytes: 8,
    });
  });

  it("encodes binary responses as base64", async () => {
    const response = await executeLocalHttp((_request, outgoing) => {
      outgoing.setHeader("Content-Type", "application/octet-stream");
      outgoing.end(Buffer.from([0, 1, 2, 254, 255]));
    });

    expect(response).toMatchObject({
      status: 200,
      bodyEncoding: "base64",
      body: "AAEC/v8=",
      sizeBytes: 5,
    });
  });

  it("preserves 422 responses as normal results", async () => {
    const response = await executeLocalHttp((_request, outgoing) => {
      outgoing.writeHead(422, { "Content-Type": "application/json" });
      outgoing.end('{"error":"invalid input"}');
    });

    expect(response).toMatchObject({
      status: 422,
      bodyEncoding: "json",
      body: { error: "invalid input" },
    });
  });

  it("preserves 500 responses as normal results", async () => {
    const response = await executeLocalHttp((_request, outgoing) => {
      outgoing.writeHead(500, { "Content-Type": "text/plain" });
      outgoing.end("upstream failed");
    });

    expect(response).toMatchObject({
      status: 500,
      bodyEncoding: "text",
      body: "upstream failed",
    });
  });

  it("rejects redirects instead of following Location", async () => {
    await expect(
      executeLocalHttp((_request, outgoing) => {
        outgoing.writeHead(307, {
          Location: "https://other-origin.test/steal-proof",
        });
        outgoing.end();
      }),
    ).rejects.toMatchObject({ code: "redirect_not_supported" });
  });

  it("destroys timed-out requests with an explicit error", async () => {
    let resolveResponseClosed!: (writableFinished: boolean) => void;
    const responseClosed = new Promise<boolean>((resolve) => {
      resolveResponseClosed = resolve;
    });
    await expect(
      executeLocalHttp((_request, outgoing) => {
        outgoing.once("close", () => {
          resolveResponseClosed(outgoing.writableFinished);
        });
      }, { timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: "request_timeout" });
    await expect(responseClosed).resolves.toBe(false);
  });

  it("destroys responses immediately above the default 1 MiB byte limit", async () => {
    let resolveResponseClosed!: (writableFinished: boolean) => void;
    const responseClosed = new Promise<boolean>((resolve) => {
      resolveResponseClosed = resolve;
    });
    await expect(
      executeLocalHttp((_request, outgoing) => {
        outgoing.setHeader("Content-Type", "application/octet-stream");
        const interval = setInterval(() => {
          outgoing.write(Buffer.alloc(64 * 1024));
        }, 1);
        outgoing.once("close", () => {
          clearInterval(interval);
          resolveResponseClosed(outgoing.writableFinished);
        });
      }),
    ).rejects.toMatchObject({ code: "response_too_large" });
    await expect(responseClosed).resolves.toBe(false);
  });

  it("returns an intact response at the exact 1 MiB byte limit", async () => {
    const payload = Buffer.alloc(1024 * 1024, 0xa5);
    const response = await executeLocalHttp((_request, outgoing) => {
      outgoing.setHeader("Content-Type", "application/octet-stream");
      outgoing.end(payload);
    });

    expect(response).toMatchObject({
      status: 200,
      bodyEncoding: "base64",
      sizeBytes: 1024 * 1024,
      truncated: false,
    });
    expect(Buffer.from(String(response.body), "base64")).toEqual(payload);
  });

  it("uses the pinned resolver without a second upstream resolution", async () => {
    const { origin } = await startHttpServer((_request, outgoing) => {
      outgoing.setHeader("Content-Type", "text/plain");
      outgoing.end("pinned");
    });
    const url = `${origin}/paid`;
    const upstreamResolver = vi.fn(() => Promise.resolve(["127.0.0.1"]));
    const validated = await assertPaidHttpUrlAllowed(url, {
      allowHttpOrigins: [origin],
      resolveHostname: upstreamResolver,
    });
    const pinnedResolver = vi.fn(validated.resolveHostname);

    const response = await executeBoundedHttpRequest(
      normalizePaidHttpRequest({ url, method: "GET", headers: [] }),
      { ...validated, resolveHostname: pinnedResolver },
    );

    expect(response.body).toBe("pinned");
    expect(upstreamResolver).toHaveBeenCalledTimes(1);
    expect(pinnedResolver).toHaveBeenCalledWith("merchant.test");
  });

  it("keeps the validated hostname for TLS SNI and Host while connecting to the pinned IP", async () => {
    let resolveReceivedTls!: (value: {
      readonly host: string | undefined;
      readonly servername: string | false | null;
    }) => void;
    const receivedTls = new Promise<{
      readonly host: string | undefined;
      readonly servername: string | false | null;
    }>((resolve) => {
      resolveReceivedTls = resolve;
    });
    const server = createHttpsServer(
      { cert: TLS_CERT, key: TLS_KEY },
      (request, outgoing) => {
        resolveReceivedTls({
          host: request.headers.host,
          servername: (request.socket as TLSSocket).servername,
        });
        outgoing.setHeader("Content-Type", "text/plain");
        outgoing.end("secure and pinned");
      },
    );
    openServers.add(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Test HTTPS server did not bind to TCP");
    }

    const url = `https://merchant.test:${address.port}/paid`;
    const pinnedResolver = vi.fn(() => Promise.resolve(["127.0.0.1"]));
    let connectorOptions: RequestOptions | undefined;
    const response = await executeBoundedHttpRequest(
      normalizePaidHttpRequest({ url, method: "GET", headers: [] }),
      {
        url,
        hostname: "merchant.test",
        addresses: ["127.0.0.1"],
        resolveHostname: pinnedResolver,
      },
      {
        requestConnector: (requestUrl, requestOptions, onResponse) => {
          connectorOptions = requestOptions;
          return requestHttps(
            requestUrl,
            { ...requestOptions, ca: TLS_CERT },
            onResponse,
          );
        },
      },
    );

    expect(response.body).toBe("secure and pinned");
    expect(pinnedResolver).toHaveBeenCalledWith("merchant.test");
    expect(connectorOptions?.servername).toBe("merchant.test");
    await expect(receivedTls).resolves.toEqual({
      host: `merchant.test:${address.port}`,
      servername: "merchant.test",
    });
  });

  it("never reuses a shared socket that bypasses the pinned resolver", async () => {
    const { origin } = await startHttpServer((_request, outgoing) => {
      outgoing.setHeader("Content-Type", "text/plain");
      outgoing.end("connected");
    });
    const url = `${origin}/paid`;
    await new Promise<void>((resolve, reject) => {
      const primingRequest = requestHttp(
        url,
        {
          lookup: (_hostname, options, callback) => {
            if (typeof options !== "number" && options.all) {
              callback(null, [{ address: "127.0.0.1", family: 4 }]);
            } else {
              callback(null, "127.0.0.1", 4);
            }
          },
        },
        (response) => {
          response.resume();
          response.once("end", resolve);
        },
      );
      primingRequest.once("error", reject);
      primingRequest.end();
    });

    const validated = await assertPaidHttpUrlAllowed(url, {
      allowHttpOrigins: [origin],
      resolveHostname: () => Promise.resolve(["127.0.0.1"]),
    });
    const pinnedResolver = vi.fn(validated.resolveHostname);
    await executeBoundedHttpRequest(
      normalizePaidHttpRequest({ url, method: "GET", headers: [] }),
      { ...validated, resolveHostname: pinnedResolver },
    );

    expect(pinnedResolver).toHaveBeenCalledWith("merchant.test");
  });

  it("returns an explicit error for invalid JSON responses", async () => {
    await expect(
      executeLocalHttp((_request, outgoing) => {
        outgoing.setHeader("Content-Type", "application/json");
        outgoing.end('{"incomplete":');
      }),
    ).rejects.toMatchObject({ code: "invalid_json" });
  });
});

describe("paymentRequiredFromResponse", () => {
  it("decodes a v2 PAYMENT-REQUIRED response header", () => {
    const encoded = encodePaymentRequiredHeader(validPaymentRequired);

    expect(
      paymentRequiredFromResponse(
        responseForDiscovery({
          headers: [["PAYMENT-REQUIRED", encoded]],
          bodyEncoding: "text",
          body: "ignored header fallback body",
        }),
      ),
    ).toEqual(validPaymentRequired);
  });

  it("falls back to the current JSON response body", () => {
    expect(paymentRequiredFromResponse(responseForDiscovery())).toEqual(
      validPaymentRequired,
    );
  });

  it("rejects non-402 responses", () => {
    expect(() =>
      paymentRequiredFromResponse(responseForDiscovery({ status: 200 })),
    ).toThrowError(expect.objectContaining({ code: "not_payment_required" }));
  });

  it("rejects a missing payment quote", () => {
    expect(() =>
      paymentRequiredFromResponse(
        responseForDiscovery({
          contentType: "text/plain",
          bodyEncoding: "text",
          body: "Payment required",
        }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "payment_required_missing" }),
    );
  });

  it("rejects an invalid payment quote", () => {
    expect(() =>
      paymentRequiredFromResponse(
        responseForDiscovery({ headers: [["Payment-Required", "not-base64"]] }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "payment_required_invalid" }),
    );
  });

  it("rejects a payment quote with no accepted payment options", () => {
    expect(() =>
      paymentRequiredFromResponse(
        responseForDiscovery({
          body: { ...validPaymentRequired, accepts: [] },
        }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "payment_required_empty_accepts" }),
    );
  });
});

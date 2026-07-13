import { describe, expect, it } from "vitest";

import {
  assertPaidHttpUrlAllowed,
  canonicalPaidHttpRequestHash,
  normalizePaidHttpRequest,
} from "../../src/engines/payments/x402-http.js";

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
  it("requires HTTPS unless the exact HTTP origin is allowed", async () => {
    const resolveHostname = () =>
      Promise.resolve(["93.184.216.34"] as const);

    await expect(
      assertPaidHttpUrlAllowed("http://example.com/pay", { resolveHostname }),
    ).rejects.toThrow(/HTTPS/i);
    await expect(
      assertPaidHttpUrlAllowed("http://localhost:8080/pay", {
        allowHttpOrigins: ["http://localhost:8080"],
        resolveHostname: () =>
          Promise.reject(
            new Error("explicitly allowed origins should bypass DNS"),
          ),
      }),
    ).resolves.toBeUndefined();
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
      "192.168.1.1",
      "224.0.0.1",
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
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
    ).resolves.toBeUndefined();
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { checkFreshness, isAllowedUrl } from "../../src/http/freshnessChecker.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkFreshness", () => {
  it("sends If-None-Match header when etag is stored", async () => {
    let capturedHeaders: Record<string, string> = {};

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init: RequestInit) => {
        capturedHeaders = Object.fromEntries(new Headers(init.headers as HeadersInit).entries());
        return Promise.resolve({
          status: 304,
          statusText: "Not Modified",
          headers: { get: () => null },
        });
      }),
    );

    await checkFreshness({ url: "https://example.com", etag: '"abc123"' });
    expect(capturedHeaders["if-none-match"]).toBe('"abc123"');
  });

  it("sends If-Modified-Since header when last_modified is stored", async () => {
    let capturedHeaders: Record<string, string> = {};

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init: RequestInit) => {
        capturedHeaders = Object.fromEntries(new Headers(init.headers as HeadersInit).entries());
        return Promise.resolve({
          status: 304,
          statusText: "Not Modified",
          headers: { get: () => null },
        });
      }),
    );

    await checkFreshness({ url: "https://example.com", last_modified: "Mon, 01 Jan 2026 00:00:00 GMT" });
    expect(capturedHeaders["if-modified-since"]).toBe("Mon, 01 Jan 2026 00:00:00 GMT");
  });

  it("correctly parses 304 → fresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 304,
        statusText: "Not Modified",
        headers: { get: () => null },
      }),
    );

    const result = await checkFreshness({ url: "https://example.com" });
    expect(result.status).toBe("fresh");
    expect(result.http_status).toBe(304);
  });

  it("correctly parses 200 → stale", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        statusText: "OK",
        headers: { get: (name: string) => (name === "etag" ? '"new-etag"' : null) },
      }),
    );

    const result = await checkFreshness({ url: "https://example.com" });
    expect(result.status).toBe("stale");
    expect(result.http_status).toBe(200);
  });

  it("extracts ETag from 200 response headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        statusText: "OK",
        headers: { get: (name: string) => (name === "etag" ? '"new-etag-xyz"' : null) },
      }),
    );

    const result = await checkFreshness({ url: "https://example.com" });
    expect(result.etag).toBe('"new-etag-xyz"');
  });

  it("network timeout → error result, no throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })),
    );

    const result = await checkFreshness({ url: "https://example.com" });
    expect(result.status).toBe("error");
    expect(result.error).toBeDefined();
  });

  it("4xx status → error result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 404,
        statusText: "Not Found",
        headers: { get: () => null },
      }),
    );

    const result = await checkFreshness({ url: "https://example.com" });
    expect(result.status).toBe("error");
    expect(result.http_status).toBe(404);
  });

  it("5xx status → error result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 500,
        statusText: "Internal Server Error",
        headers: { get: () => null },
      }),
    );

    const result = await checkFreshness({ url: "https://example.com" });
    expect(result.status).toBe("error");
    expect(result.http_status).toBe(500);
  });

  it("does not include etag from 304 response (no body sent)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 304,
        statusText: "Not Modified",
        headers: { get: () => null },
      }),
    );

    const result = await checkFreshness({ url: "https://example.com", etag: '"stored-etag"' });
    expect(result.status).toBe("fresh");
    // Should not update etag on 304
    expect(result.etag).toBeUndefined();
  });
});

describe("isAllowedUrl (SSRF guard)", () => {
  it("blocks loopback IPv4 (127.0.0.1)", () => {
    const result = isAllowedUrl("http://127.0.0.1/secret");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("private/loopback");
  });

  it("blocks loopback IPv6 (::1)", () => {
    const result = isAllowedUrl("http://[::1]/secret");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("private/loopback");
  });

  it("blocks RFC-1918 class A (10.0.0.1)", () => {
    const result = isAllowedUrl("http://10.0.0.1/internal");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("private/loopback");
  });

  it("blocks RFC-1918 class B (172.16.0.1)", () => {
    const result = isAllowedUrl("http://172.16.0.1/internal");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("private/loopback");
  });

  it("blocks RFC-1918 class C (192.168.1.1)", () => {
    const result = isAllowedUrl("http://192.168.1.1/internal");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("private/loopback");
  });

  it("blocks IPv6 ULA (fc00::1)", () => {
    const result = isAllowedUrl("http://[fc00::1]/internal");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("private/loopback");
  });

  it("allows public HTTPS URL", () => {
    const result = isAllowedUrl("https://api.example.com/data");
    expect(result.allowed).toBe(true);
  });

  it("allows plain HTTP to public host", () => {
    const result = isAllowedUrl("http://api.example.com/data");
    expect(result.allowed).toBe(true);
  });
});

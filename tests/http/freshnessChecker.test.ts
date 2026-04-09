import { describe, it, expect, vi, afterEach } from "vitest";
import { checkFreshness } from "../../src/http/freshnessChecker.js";

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

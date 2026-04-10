import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkFreshnessCommand } from "../../src/commands/checkFreshness.js";

const EXTERNAL_DIR = join(".ai", "external-context-gatherer_cache");

let origCwd: string;
let tmpDir: string;

beforeEach(async () => {
  origCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "cache-ctrl-freshness-"));
  process.chdir(tmpDir);
  await mkdir(join(tmpDir, EXTERNAL_DIR), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.chdir(origCwd);
});

function makeFetchedAt(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
}

async function writeExternalCache(subject: string, data: Record<string, unknown>): Promise<string> {
  const filePath = join(tmpDir, EXTERNAL_DIR, `${subject}.json`);
  await writeFile(filePath, JSON.stringify(data));
  return filePath;
}

describe("checkFreshnessCommand", () => {
  it("returns fresh for mocked 304 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 304,
        statusText: "Not Modified",
        headers: { get: () => null },
      }),
    );

    await writeExternalCache("mylib", {
      subject: "mylib",
      description: "My library",
      fetched_at: makeFetchedAt(1),
      sources: [{ type: "docs", url: "https://example.com/docs" }],
      header_metadata: {
        "https://example.com/docs": { etag: '"abc123"', checked_at: makeFetchedAt(2), status: "fresh" },
      },
    });

    const result = await checkFreshnessCommand({ subject: "mylib" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sources[0]!.status).toBe("fresh");
    expect(result.value.overall).toBe("fresh");
  });

  it("returns stale for mocked 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        statusText: "OK",
        headers: { get: (name: string) => (name === "etag" ? '"new-etag"' : null) },
      }),
    );

    await writeExternalCache("mylib", {
      subject: "mylib",
      description: "My library",
      fetched_at: makeFetchedAt(1),
      sources: [{ type: "docs", url: "https://example.com/docs" }],
      header_metadata: {},
    });

    const result = await checkFreshnessCommand({ subject: "mylib" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sources[0]!.status).toBe("stale");
    expect(result.value.overall).toBe("stale");
  });

  it("returns error for network failure without modifying cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error")),
    );

    const filePath = await writeExternalCache("mylib", {
      subject: "mylib",
      description: "My library",
      fetched_at: makeFetchedAt(1),
      sources: [{ type: "docs", url: "https://example.com/docs" }],
      header_metadata: { "https://example.com/docs": { checked_at: "2026-01-01T00:00:00Z", status: "fresh" } },
    });

    const originalContent = await readFile(filePath, "utf-8");
    const result = await checkFreshnessCommand({ subject: "mylib" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sources[0]!.status).toBe("error");

    // Cache should not be modified
    const newContent = await readFile(filePath, "utf-8");
    expect(newContent).toBe(originalContent);
  });

  it("updates header_metadata with new ETag on 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        statusText: "OK",
        headers: { get: (name: string) => (name === "etag" ? '"new-etag-456"' : null) },
      }),
    );

    const filePath = await writeExternalCache("mylib", {
      subject: "mylib",
      description: "My library",
      fetched_at: makeFetchedAt(1),
      sources: [{ type: "docs", url: "https://example.com/docs" }],
      header_metadata: {},
    });

    const result = await checkFreshnessCommand({ subject: "mylib" });
    expect(result.ok).toBe(true);

    const content = JSON.parse(await readFile(filePath, "utf-8")) as Record<string, unknown>;
    const meta = (content.header_metadata as Record<string, unknown>)["https://example.com/docs"] as Record<string, unknown>;
    expect(meta.etag).toBe('"new-etag-456"');
    expect(meta.status).toBe("stale");
  });

  it("returns overall: stale when any source is stale", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ status: 304, statusText: "Not Modified", headers: { get: () => null } });
        }
        return Promise.resolve({ status: 200, statusText: "OK", headers: { get: () => null } });
      }),
    );

    await writeExternalCache("mylib", {
      subject: "mylib",
      description: "My library",
      fetched_at: makeFetchedAt(1),
      sources: [
        { type: "docs", url: "https://example.com/docs1" },
        { type: "api", url: "https://example.com/api" },
      ],
      header_metadata: {},
    });

    const result = await checkFreshnessCommand({ subject: "mylib" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.overall).toBe("stale");
  });

  it("returns overall: stale for entries older than 24h regardless of HTTP status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 304,
        statusText: "Not Modified",
        headers: { get: () => null },
      }),
    );

    await writeExternalCache("mylib", {
      subject: "mylib",
      description: "My library",
      fetched_at: makeFetchedAt(25), // 25 hours old
      sources: [{ type: "docs", url: "https://example.com/docs" }],
      header_metadata: {},
    });

    const result = await checkFreshnessCommand({ subject: "mylib" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.overall).toBe("stale");
  });

  it("returns URL_NOT_FOUND when --url is not in sources", async () => {
    await writeExternalCache("mylib", {
      subject: "mylib",
      description: "My library",
      fetched_at: makeFetchedAt(1),
      sources: [{ type: "docs", url: "https://example.com/docs" }],
      header_metadata: {},
    });

    const result = await checkFreshnessCommand({ subject: "mylib", url: "https://other.com/not-there" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("URL_NOT_FOUND");
  });

  it("returns ok:true and overall:fresh when sources is empty", async () => {
    await writeExternalCache("emptylib", {
      subject: "emptylib",
      description: "Library with no sources",
      fetched_at: makeFetchedAt(1),
      sources: [],
      header_metadata: {},
    });

    const result = await checkFreshnessCommand({ subject: "emptylib" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sources).toHaveLength(0);
    expect(result.value.overall).toBe("fresh");
  });
});

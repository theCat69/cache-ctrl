import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTopExternalMatch, getAgeHuman, mergeHeaderMetadata } from "../../src/cache/externalCache.js";
import { ErrorCode } from "../../src/types/result.js";
import type { ExternalCacheFile } from "../../src/types/cache.js";

const EXTERNAL_DIR = join(".ai", "external-context-gatherer_cache");

let origCwd: string;
let tmpDir: string;

beforeEach(async () => {
  origCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "cache-ctrl-extcache-"));
  process.chdir(tmpDir);
  await mkdir(join(tmpDir, EXTERNAL_DIR), { recursive: true });
});

afterEach(() => {
  process.chdir(origCwd);
});

async function writeEntry(subject: string, data: Record<string, unknown>): Promise<string> {
  const filePath = join(tmpDir, EXTERNAL_DIR, `${subject}.json`);
  await writeFile(filePath, JSON.stringify(data));
  return filePath;
}

function makeEntry(subject: string, description?: string): Record<string, unknown> {
  return {
    subject,
    description: description ?? `Description for ${subject}`,
    fetched_at: "2026-04-01T00:00:00Z",
    sources: [],
    header_metadata: {},
  };
}

function makeExternalFile(headerMetadata: ExternalCacheFile["header_metadata"]): ExternalCacheFile {
  return {
    subject: "subject",
    description: "description",
    fetched_at: "2026-04-01T00:00:00Z",
    sources: [],
    header_metadata: headerMetadata,
  };
}

describe("getAgeHuman", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats seconds-range ages as just now", () => {
    const fetchedAt = new Date(Date.now() - 30_000).toISOString();
    expect(getAgeHuman(fetchedAt)).toBe("just now");
  });

  it("formats minutes-range ages with minute units", () => {
    const fetchedAt = new Date(Date.now() - 2 * 60_000).toISOString();
    expect(getAgeHuman(fetchedAt)).toBe("2 minutes ago");
  });

  it("formats hours-range ages with hour units", () => {
    const fetchedAt = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(getAgeHuman(fetchedAt)).toBe("3 hours ago");
  });

  it("formats days-range ages with day units", () => {
    const fetchedAt = new Date(Date.now() - 4 * 86_400_000).toISOString();
    expect(getAgeHuman(fetchedAt)).toBe("4 days ago");
  });

  it("handles minute/hour/day boundary values exactly", () => {
    expect(getAgeHuman(new Date(Date.now() - 59_999).toISOString())).toBe("just now");
    expect(getAgeHuman(new Date(Date.now() - 60_000).toISOString())).toBe("1 minute ago");
    expect(getAgeHuman(new Date(Date.now() - 3_599_999).toISOString())).toBe("59 minutes ago");
    expect(getAgeHuman(new Date(Date.now() - 3_600_000).toISOString())).toBe("1 hour ago");
    expect(getAgeHuman(new Date(Date.now() - 86_399_999).toISOString())).toBe("23 hours ago");
    expect(getAgeHuman(new Date(Date.now() - 86_400_000).toISOString())).toBe("1 day ago");
  });
});

describe("mergeHeaderMetadata", () => {
  it("merges disjoint URL metadata sets", () => {
    const base = makeExternalFile({
      "https://a.example": { checked_at: "2026-04-10T00:00:00Z", status: "fresh" },
    });
    const merged = mergeHeaderMetadata(base, {
      "https://b.example": { checked_at: "2026-04-11T00:00:00Z", status: "stale", etag: "etag-b" },
    });

    expect(merged.header_metadata).toEqual({
      "https://a.example": { checked_at: "2026-04-10T00:00:00Z", status: "fresh" },
      "https://b.example": { checked_at: "2026-04-11T00:00:00Z", status: "stale", etag: "etag-b" },
    });
  });

  it("overwrites existing URL metadata when update contains same URL", () => {
    const base = makeExternalFile({
      "https://same.example": {
        checked_at: "2026-04-10T00:00:00Z",
        status: "fresh",
        etag: "old",
      },
    });
    const merged = mergeHeaderMetadata(base, {
      "https://same.example": {
        checked_at: "2026-04-11T00:00:00Z",
        status: "stale",
        last_modified: "Mon, 01 Apr 2026 00:00:00 GMT",
      },
    });

    expect(merged.header_metadata).toEqual({
      "https://same.example": {
        checked_at: "2026-04-11T00:00:00Z",
        status: "stale",
        last_modified: "Mon, 01 Apr 2026 00:00:00 GMT",
      },
    });
  });

  it("returns unchanged shape for empty update inputs", () => {
    const base = makeExternalFile({});
    const merged = mergeHeaderMetadata(base, {});

    expect(merged.subject).toBe("subject");
    expect(merged.description).toBe("description");
    expect(merged.header_metadata).toEqual({});
  });
});

describe("resolveTopExternalMatch", () => {
  it("returns NO_MATCH when no files exist", async () => {
    const result = await resolveTopExternalMatch(tmpDir, "anything");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.NO_MATCH);
  });

  it("returns NO_MATCH when no file matches the keyword (zero-score path)", async () => {
    await writeEntry("vitest", makeEntry("vitest", "Vitest test runner docs"));

    const result = await resolveTopExternalMatch(tmpDir, "zzzunmatched");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.NO_MATCH);
  });

  it("returns the matching file path when a single entry matches", async () => {
    const filePath = await writeEntry("vitest", makeEntry("vitest", "Vitest test runner docs"));

    const result = await resolveTopExternalMatch(tmpDir, "vitest");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(filePath);
  });

  it("returns the higher-scoring file when scores differ", async () => {
    // "angular" scores highest on exact stem match; "angulardocs" scores lower (substring)
    const angularPath = await writeEntry("angular", makeEntry("angular", "Angular framework"));
    await writeEntry("angulardocs", makeEntry("angulardocs", "Angular extra docs"));

    const result = await resolveTopExternalMatch(tmpDir, "angular");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Exact stem match score (100) beats substring stem match score (80)
    expect(result.value).toBe(angularPath);
  });

  it("returns one result consistently when two entries have equal score (tie-break by sort stability)", async () => {
    // Both have the keyword in their description only (score 30 each)
    await writeEntry("alpha", makeEntry("alpha", "shared keyword topic"));
    await writeEntry("beta", makeEntry("beta", "shared keyword topic"));

    const result = await resolveTopExternalMatch(tmpDir, "shared");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both are valid — just assert one is returned deterministically
    expect(result.value).toMatch(/\/(alpha|beta)\.json$/);
  });
});

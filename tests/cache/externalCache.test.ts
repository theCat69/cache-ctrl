import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTopExternalMatch } from "../../src/cache/externalCache.js";
import { ErrorCode } from "../../src/types/result.js";

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

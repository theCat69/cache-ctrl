import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readCache, writeCache } from "../../src/cache/cacheManager.js";
import { resolveGraphCachePath } from "../../src/cache/graphCache.js";
import { GraphCacheFileSchema } from "../../src/types/cache.js";
import type { GraphCacheFile } from "../../src/cache/graphCache.js";

let origCwd: string;
let tmpDir: string;

beforeEach(async () => {
  origCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "cache-ctrl-graph-cache-"));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(origCwd);
});

describe("graphCache", () => {
  it("resolves graph.json under .ai/local-context-gatherer_cache", () => {
    const graphPath = resolveGraphCachePath(tmpDir);
    expect(graphPath.endsWith(join(".ai", "local-context-gatherer_cache", "graph.json"))).toBe(true);
  });

  it("resolves graph cache path using subject-like inputs unchanged", () => {
    const graphPath = resolveGraphCachePath(tmpDir);
    expect(graphPath).toBe(join(tmpDir, ".ai", "local-context-gatherer_cache", "graph.json"));
  });

  it("round-trips GraphCacheFile with writeCache/readCache and schema validation", async () => {
    const graphPath = resolveGraphCachePath(tmpDir);
    const graphData: GraphCacheFile = {
      files: {
        "src/index.ts": {
          rank: 1,
          deps: ["src/commands/invalidate.ts"],
          defs: ["main"],
        },
      },
      computed_at: "2026-04-11T00:00:00.000Z",
    };

    const writeResult = await writeCache(graphPath, graphData);
    expect(writeResult.ok).toBe(true);
    if (!writeResult.ok) return;

    const readResult = await readCache(graphPath);
    expect(readResult.ok).toBe(true);
    if (!readResult.ok) return;

    const parsed = GraphCacheFileSchema.safeParse(readResult.value);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.computed_at).toBe(graphData.computed_at);

    const rawContent = JSON.parse(await readFile(graphPath, "utf-8")) as Record<string, unknown>;
    expect(rawContent.computed_at).toBe(graphData.computed_at);
  });
});

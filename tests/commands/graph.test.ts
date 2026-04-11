import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { graphCommand } from "../../src/commands/graph.js";
import { ErrorCode } from "../../src/types/result.js";

const GRAPH_DIR = join(".ai", "local-context-gatherer_cache");

let originalCwd: string;
let tempDir: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(join(tmpdir(), "cache-ctrl-graph-"));
  process.chdir(tempDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

async function writeGraphFile(repoRoot: string, payload: unknown): Promise<void> {
  const graphDir = join(repoRoot, GRAPH_DIR);
  await mkdir(graphDir, { recursive: true });
  await writeFile(join(graphDir, "graph.json"), JSON.stringify(payload));
}

describe("graphCommand", () => {
  it("returns FILE_NOT_FOUND when graph.json does not exist", async () => {
    const result = await graphCommand({});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.FILE_NOT_FOUND);
    expect(result.error).toContain("graph.json not found");
  });

  it("returns PARSE_ERROR when graph.json has invalid schema", async () => {
    await writeGraphFile(tempDir, {
      files: [],
      computed_at: "2026-04-11T00:00:00.000Z",
    });

    const result = await graphCommand({});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.PARSE_ERROR);
  });

  it("returns ranked files sorted by rank with token budget applied", async () => {
    await writeGraphFile(tempDir, {
      files: {
        "src/a.ts": { rank: 0.1, deps: ["src/b.ts", "src/c.ts"], defs: ["A"] },
        "src/b.ts": { rank: 0.2, deps: ["src/c.ts"], defs: ["B"] },
        "src/c.ts": { rank: 0.3, deps: [], defs: ["C"] },
        "src/d.ts": { rank: 0.4, deps: ["src/c.ts"], defs: ["D"] },
      },
      computed_at: "2026-04-11T12:00:00.000Z",
    });

    const result = await graphCommand({ maxTokens: 220 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.total_files).toBe(4);
    expect(result.value.token_estimate).toBeLessThanOrEqual(220);
    expect(result.value.ranked_files.length).toBeGreaterThan(0);

    for (let i = 1; i < result.value.ranked_files.length; i += 1) {
      expect(result.value.ranked_files[i - 1]!.rank).toBeGreaterThanOrEqual(
        result.value.ranked_files[i]!.rank,
      );
    }
  });

  it("clamps maxTokens to minimum token budget", async () => {
    await writeGraphFile(tempDir, {
      files: {
        "src/a.ts": { rank: 0.3, deps: [], defs: ["A"] },
        "src/b.ts": { rank: 0.2, deps: [], defs: ["B"] },
      },
      computed_at: "2026-04-11T12:00:00.000Z",
    });

    const result = await graphCommand({ maxTokens: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ranked_files.length).toBeGreaterThan(0);
  });

  it("personalizes ranking with seed files", async () => {
    await writeGraphFile(tempDir, {
      files: {
        "src/a.ts": { rank: 0.1, deps: ["src/c.ts"], defs: ["A"] },
        "src/b.ts": { rank: 0.1, deps: ["src/c.ts"], defs: ["B"] },
        "src/c.ts": { rank: 0.1, deps: [], defs: ["C"] },
        "src/feature.ts": { rank: 0.1, deps: ["src/c.ts"], defs: ["Feature"] },
      },
      computed_at: "2026-04-11T12:00:00.000Z",
    });

    const result = await graphCommand({ seed: ["src/feature.ts"], maxTokens: 1024 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const topPaths = result.value.ranked_files.slice(0, 3).map((entry) => entry.path);
    expect(topPaths).toContain("src/feature.ts");
  });
});

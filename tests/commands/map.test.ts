import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mapCommand } from "../../src/commands/map.js";
import { ErrorCode } from "../../src/types/result.js";

const LOCAL_DIR = join(".ai", "local-context-gatherer_cache");

let originalCwd: string;
let tempDir: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(join(tmpdir(), "cache-ctrl-map-"));
  process.chdir(tempDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

async function writeContextJson(payload: unknown): Promise<void> {
  const localDir = join(tempDir, LOCAL_DIR);
  await mkdir(localDir, { recursive: true });
  await writeFile(join(localDir, "context.json"), JSON.stringify(payload), "utf-8");
}

describe("mapCommand", () => {
  it("returns FILE_NOT_FOUND when context.json does not exist", async () => {
    const result = await mapCommand({});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.FILE_NOT_FOUND);
    expect(result.error).toContain("context.json not found");
  });

  it("returns PARSE_ERROR when context.json is malformed", async () => {
    await writeContextJson({
      timestamp: "2026-04-11T00:00:00.000Z",
      topic: "local context",
      description: "bad shape",
      tracked_files: [],
      facts: [],
    });

    const result = await mapCommand({});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.PARSE_ERROR);
  });

  it("overview depth returns sorted files without facts or modules", async () => {
    await writeContextJson({
      timestamp: "2026-04-11T00:00:00.000Z",
      topic: "local context",
      description: "test",
      tracked_files: [],
      global_facts: ["strict TS"],
      facts: {
        "src/zeta.ts": {
          summary: "zeta",
          role: "implementation",
          importance: 2,
          facts: ["zeta fact"],
        },
        "src/alpha.ts": {
          summary: "alpha",
          role: "entry-point",
          importance: 1,
          facts: ["alpha fact"],
        },
      },
    });

    const result = await mapCommand({ depth: "overview" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.depth).toBe("overview");
    expect(result.value.modules).toBeUndefined();
    expect(result.value.files[0]?.path).toBe("src/alpha.ts");
    expect(result.value.files[1]?.path).toBe("src/zeta.ts");
    expect(result.value.files[0]).toMatchObject({
      path: "src/alpha.ts",
      summary: "alpha",
      role: "entry-point",
      importance: 1,
    });
    expect(result.value.files[0]).not.toHaveProperty("facts");
    expect(result.value.total_files).toBe(2);
  });

  it("modules depth includes modules field", async () => {
    await writeContextJson({
      timestamp: "2026-04-11T00:00:00.000Z",
      topic: "local context",
      description: "test",
      tracked_files: [],
      facts: {
        "src/commands/map.ts": {
          summary: "map command",
          role: "implementation",
          importance: 1,
        },
      },
      modules: {
        commands: ["src/commands/map.ts"],
      },
    });

    const result = await mapCommand({ depth: "modules" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.modules).toEqual({ commands: ["src/commands/map.ts"] });
  });

  it("full depth includes per-file facts arrays", async () => {
    await writeContextJson({
      timestamp: "2026-04-11T00:00:00.000Z",
      topic: "local context",
      description: "test",
      tracked_files: [],
      facts: {
        "src/commands/map.ts": {
          summary: "map command",
          role: "implementation",
          importance: 1,
          facts: ["reads context", "sorts by importance"],
        },
      },
    });

    const result = await mapCommand({ depth: "full" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files[0]?.facts).toEqual(["reads context", "sorts by importance"]);
  });

  it("applies folder filter by path prefix", async () => {
    await writeContextJson({
      timestamp: "2026-04-11T00:00:00.000Z",
      topic: "local context",
      description: "test",
      tracked_files: [],
      facts: {
        "src/commands/map.ts": { summary: "map", importance: 1 },
        "src/cache/localCache.ts": { summary: "local", importance: 1 },
      },
    });

    const result = await mapCommand({ folder: "src/commands" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.folder_filter).toBe("src/commands");
    expect(result.value.files).toHaveLength(1);
    expect(result.value.files[0]?.path).toBe("src/commands/map.ts");
  });

  it("folder filter enforces path segment boundary", async () => {
    await writeContextJson({
      timestamp: "2026-04-11T00:00:00.000Z",
      topic: "local context",
      description: "test",
      tracked_files: [],
      facts: {
        "src/foo/bar.ts": { summary: "match", importance: 1 },
        "src/foobar/baz.ts": { summary: "no match", importance: 1 },
      },
    });

    const result = await mapCommand({ folder: "src/foo" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files).toHaveLength(1);
    expect(result.value.files[0]?.path).toBe("src/foo/bar.ts");
  });

  it("returns empty files when facts field is absent", async () => {
    await writeContextJson({
      timestamp: "2026-04-11T00:00:00.000Z",
      topic: "local context",
      description: "test",
      tracked_files: [],
      global_facts: ["bun runtime"],
    });

    const result = await mapCommand({});

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files).toEqual([]);
    expect(result.value.total_files).toBe(0);
    expect(result.value.global_facts).toEqual(["bun runtime"]);
  });
});

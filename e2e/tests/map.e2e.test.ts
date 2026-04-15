import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { runCli, parseJsonOutput } from "../helpers/cli.ts";
import { createTestRepo, type TestRepo } from "../helpers/repo.ts";

let repo: TestRepo;

beforeEach(async () => {
  repo = await createTestRepo();
});

afterEach(async () => {
  await repo.cleanup();
});

async function writeContextJson(repoDir: string): Promise<void> {
  const localCacheDir = join(repoDir, ".ai", "local-context-gatherer_cache");
  await mkdir(localCacheDir, { recursive: true });
  await writeFile(
    join(localCacheDir, "context.json"),
    JSON.stringify({
      timestamp: "2025-01-01T00:00:00.000Z",
      topic: "sample-local",
      description: "fixture local cache entry",
      tracked_files: [
        { path: "src/file-a.ts", mtime: 1735689600000 },
        { path: "src/file-b.ts", mtime: 1735689600000 },
      ],
      facts: {
        "src/file-a.ts": { facts: ["fixture file a"] },
        "src/file-b.ts": { facts: ["fixture file b"] },
      },
    }),
    "utf-8",
  );
}

describe("map", () => {
  it("default depth exits 0 and returns overview with two files", async () => {
    await writeContextJson(repo.dir);

    const result = await runCli(["map"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: {
        depth: string;
        files: Array<{ path: string }>;
        total_files: number;
      };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.depth).toBe("overview");
    expect(Array.isArray(output.value.files)).toBe(true);
    expect(output.value.total_files).toBe(2);
  });

  it("map --depth full exits 0 and includes at least one file facts array", async () => {
    await writeContextJson(repo.dir);

    const result = await runCli(["map", "--depth", "full"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: {
        depth: string;
        files: Array<{ path: string; facts?: string[] }>;
      };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.depth).toBe("full");
    expect(output.value.files.some((fileEntry) => Array.isArray(fileEntry.facts))).toBe(true);
  });

  it("map --depth modules exits 0 and includes modules grouping", async () => {
    const localCacheDir = join(repo.dir, ".ai", "local-context-gatherer_cache");
    await mkdir(localCacheDir, { recursive: true });
    await writeFile(
      join(localCacheDir, "context.json"),
      JSON.stringify({
        timestamp: "2025-01-01T00:00:00.000Z",
        topic: "sample-local",
        description: "fixture local cache entry",
        tracked_files: [
          { path: "src/file-a.ts", mtime: 1735689600000 },
          { path: "src/file-b.ts", mtime: 1735689600000 },
        ],
        facts: {
          "src/file-a.ts": { facts: ["fixture file a"] },
          "src/file-b.ts": { facts: ["fixture file b"] },
        },
        modules: {
          src: ["src/file-a.ts", "src/file-b.ts"],
        },
      }),
      "utf-8",
    );

    const result = await runCli(["map", "--depth", "modules"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: {
        depth: string;
        modules?: Record<string, string[]>;
      };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.depth).toBe("modules");
    expect(output.value.modules).toBeDefined();
    expect(typeof output.value.modules).toBe("object");
  });

  it("map --folder src exits 0 and only returns src-prefixed paths", async () => {
    await writeContextJson(repo.dir);

    const result = await runCli(["map", "--folder", "src"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: {
        folder_filter?: string;
        files: Array<{ path: string }>;
      };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.folder_filter).toBe("src");
    expect(output.value.files.length).toBeGreaterThan(0);
    for (const fileEntry of output.value.files) {
      expect(fileEntry.path.startsWith("src/")).toBe(true);
    }
  });

  it("returns FILE_NOT_FOUND when context cache directory is missing", async () => {
    await rm(join(repo.dir, ".ai"), { recursive: true, force: true });

    const result = await runCli(["map"], { cwd: repo.dir });
    expect(result.exitCode).toBe(1);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("FILE_NOT_FOUND");
  });

  it("map --depth invalid exits 2 with INVALID_ARGS", async () => {
    const result = await runCli(["map", "--depth", "invalid"], { cwd: repo.dir });
    expect(result.exitCode).toBe(2);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("INVALID_ARGS");
  });
});

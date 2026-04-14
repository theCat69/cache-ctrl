import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
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

const graphFixture = {
  files: {
    "src/file-a.ts": { deps: ["src/file-b.ts"], defs: ["ExportA"] },
    "src/file-b.ts": { deps: [], defs: ["ExportB"] },
  },
  computed_at: "2025-01-01T00:00:00.000Z",
};

async function writeGraphJson(repoDir: string, payload: unknown = graphFixture): Promise<void> {
  const graphDir = join(repoDir, ".ai", "local-context-gatherer_cache");
  await mkdir(graphDir, { recursive: true });
  await writeFile(join(graphDir, "graph.json"), JSON.stringify(payload), "utf-8");
}

describe("graph", () => {
  it("happy path exits 0 and returns ranked graph metadata", async () => {
    await writeGraphJson(repo.dir);

    const result = await runCli(["graph"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: {
        ranked_files: Array<{
          path: string;
          rank: number;
          deps: string[];
          defs: string[];
          ref_count: number;
        }>;
        total_files: number;
        computed_at: string;
        token_estimate: number;
      };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.total_files).toBe(2);
    expect(output.value.computed_at).toBe("2025-01-01T00:00:00.000Z");
    expect(output.value.token_estimate).toBeGreaterThan(0);
    expect(output.value.ranked_files).toHaveLength(2);
    for (const fileEntry of output.value.ranked_files) {
      expect(typeof fileEntry.path).toBe("string");
      expect(typeof fileEntry.rank).toBe("number");
      expect(Array.isArray(fileEntry.deps)).toBe(true);
      expect(Array.isArray(fileEntry.defs)).toBe(true);
      expect(typeof fileEntry.ref_count).toBe("number");
    }
  });

  it("graph --max-tokens 32 exits 0 and respects token budget", async () => {
    await writeGraphJson(repo.dir, {
      files: {
        "a.ts": { deps: [], defs: [] },
      },
      computed_at: "2025-01-01T00:00:00.000Z",
    });

    const result = await runCli(["graph", "--max-tokens", "32"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: {
        token_estimate: number;
      };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.token_estimate).toBeLessThanOrEqual(32);
  });

  it("returns PARSE_ERROR when graph.json is malformed", async () => {
    await writeGraphJson(repo.dir, {
      files: "not-an-object",
      computed_at: "2025-01-01T00:00:00.000Z",
    });

    const result = await runCli(["graph"], { cwd: repo.dir });
    expect(result.exitCode).toBe(1);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("PARSE_ERROR");
  });

  it("graph --seed exits 0 and includes the seeded file in ranked output", async () => {
    await writeGraphJson(repo.dir, graphFixture);

    const seededPath = "src/file-b.ts";
    const result = await runCli(["graph", "--seed", seededPath], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: {
        ranked_files: Array<{ path: string }>;
      };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.ranked_files.length).toBeGreaterThan(0);
    expect(output.value.ranked_files.some((fileEntry) => fileEntry.path === seededPath)).toBe(true);
  });

  it("returns FILE_NOT_FOUND when graph.json is absent", async () => {
    const result = await runCli(["graph"], { cwd: repo.dir });
    expect(result.exitCode).toBe(1);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("FILE_NOT_FOUND");
  });
});

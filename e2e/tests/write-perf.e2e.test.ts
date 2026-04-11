import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runCli, parseJsonOutput } from "../helpers/cli.ts";
import { createTestRepo, type TestRepo } from "../helpers/repo.ts";

const REALISTIC = 200;
const STRESS = 1_000;

/**
 * Seeds N TypeScript files under `<repoDir>/perf/` and returns their relative paths.
 */
async function seedPerfFiles(repoDir: string, n: number): Promise<string[]> {
  const perfDir = join(repoDir, "perf");
  await mkdir(perfDir, { recursive: true });
  const paths: string[] = [];
  for (let i = 0; i < n; i++) {
    const rel = `perf/file-${String(i).padStart(4, "0")}.ts`;
    await writeFile(join(repoDir, rel), `export const v${i} = ${i};\n`);
    paths.push(rel);
  }
  return paths;
}

function toTrackedFiles(paths: string[]): Array<{ path: string }> {
  return paths.map((p) => ({ path: p }));
}

/**
 * Produces facts keyed by path. The fact string embeds the array index `i`, so callers
 * must pass paths in their original seeding order to get stable, predictable values.
 * Never pass a sub-slice — the index used here will not match the file number in the name.
 */
function toFacts(paths: string[]): Record<string, { facts: string[] }> {
  return Object.fromEntries(
    paths.map((p, i) => [p, { facts: [`exported const v${i}`, "pure module"] }]),
  );
}

/** Expected facts for the file seeded at position `index`. */
function expectedFactsForIndex(index: number): string[] {
  return [`exported const v${index}`, "pure module"];
}

/**
 * Runs a delta-write scenario:
 *   1. Seeds `n` files and writes a cold-start cache.
 *   2. Writes a 1-file delta update.
 *   3. Asserts correctness and logs elapsed time for the delta step.
 */
async function runDeltaWriteTest(
  repo: TestRepo,
  n: number,
  elapsedLimitMs: number,
): Promise<void> {
  // Clear the fixture's pre-seeded context.json so the cold-start write begins
  // from a truly empty cache (no fixture tracked files survive the merge).
  await rm(join(repo.dir, ".ai"), { recursive: true, force: true });
  const paths = await seedPerfFiles(repo.dir, n);

  const coldResult = await runCli(
    [
      "write-local",
      "--data",
      JSON.stringify({
        topic: "cold start",
        description: `${n} files`,
        tracked_files: toTrackedFiles(paths),
        facts: toFacts(paths),
      }),
    ],
    { cwd: repo.dir },
  );
  expect(coldResult.exitCode, `cold-start write failed: ${coldResult.stderr}`).toBe(0);

  const updatedPath = paths[0]!;
  const updatedFacts = {
    facts: ["updated export signature", "adds optional second param"],
  };

  const start = performance.now();
  const deltaResult = await runCli(
    [
      "write-local",
      "--data",
      JSON.stringify({
        topic: "delta",
        description: "1-file delta",
        tracked_files: [{ path: updatedPath }],
        facts: { [updatedPath]: updatedFacts },
      }),
    ],
    { cwd: repo.dir },
  );
  const elapsed = Math.round(performance.now() - start);
  console.log(`\n[perf] delta write (1 file, ${n}-file cache): ${elapsed} ms`);

  expect(deltaResult.exitCode, `delta write failed: ${deltaResult.stderr}`).toBe(0);
  const out = parseJsonOutput<{ ok: boolean; value: { file: string } }>(deltaResult.stdout);
  expect(out.ok).toBe(true);
  expect(out.value.file).toMatch(/context\.json$/);

  const raw = await readFile(
    join(repo.dir, ".ai", "local-context-gatherer_cache", "context.json"),
    "utf-8",
  );
  const ctx = parseJsonOutput<{
    tracked_files: Array<{ path: string }>;
    facts: Record<string, { facts?: string[] }>;
  }>(raw);

  expect(ctx.tracked_files).toHaveLength(n);
  expect(ctx.facts[updatedPath]).toEqual(updatedFacts);

  // Verify facts for the last file are preserved using its known seeding index
  const lastIndex = n - 1;
  const preservedPath = paths[lastIndex]!;
  expect(ctx.facts[preservedPath]?.facts).toEqual(expectedFactsForIndex(lastIndex));

  expect(elapsed, `delta write exceeded ${elapsedLimitMs} ms`).toBeLessThan(elapsedLimitMs);
}

describe("write local — performance", () => {
  let repo: TestRepo;

  beforeEach(async () => {
    repo = await createTestRepo();
  });

  afterEach(async () => {
    await repo.cleanup();
  });

  it(
    `cold start: ${REALISTIC} files — resolveTrackedFileStats throughput`,
    async () => {
      // Clear the fixture's pre-seeded context.json so the merge starts from empty.
      await rm(join(repo.dir, ".ai"), { recursive: true, force: true });
      const paths = await seedPerfFiles(repo.dir, REALISTIC);

      const payload = {
        topic: "perf cold start",
        description: `${REALISTIC} files`,
        tracked_files: toTrackedFiles(paths),
        facts: toFacts(paths),
      };

      const start = performance.now();
      const result = await runCli(
        ["write-local", "--data", JSON.stringify(payload)],
        { cwd: repo.dir },
      );
      const elapsed = Math.round(performance.now() - start);
      console.log(`\n[perf] cold-start write (${REALISTIC} files): ${elapsed} ms`);

      expect(result.exitCode, `write failed — stderr: ${result.stderr}`).toBe(0);
      const out = parseJsonOutput<{ ok: boolean; value: { file: string } }>(result.stdout);
      expect(out.ok).toBe(true);
      expect(out.value.file).toMatch(/context\.json$/);

      const raw = await readFile(
        join(repo.dir, ".ai", "local-context-gatherer_cache", "context.json"),
        "utf-8",
      );
      const ctx = parseJsonOutput<{
        tracked_files: unknown[];
        facts: Record<string, unknown>;
      }>(raw);
      expect(ctx.tracked_files).toHaveLength(REALISTIC);
      expect(Object.keys(ctx.facts)).toHaveLength(REALISTIC);

      expect(elapsed, `cold-start write exceeded 20 000 ms`).toBeLessThan(20_000);
    },
    30_000,
  );

  it(
    `cold start: ${STRESS} files — stress resolveTrackedFileStats`,
    async () => {
      // Clear the fixture's pre-seeded context.json so the merge starts from empty.
      await rm(join(repo.dir, ".ai"), { recursive: true, force: true });
      const paths = await seedPerfFiles(repo.dir, STRESS);

      const payload = {
        topic: "perf stress cold start",
        description: `${STRESS} files`,
        tracked_files: toTrackedFiles(paths),
        facts: toFacts(paths),
      };

      const start = performance.now();
      const result = await runCli(
        ["write-local", "--data", JSON.stringify(payload)],
        { cwd: repo.dir },
      );
      const elapsed = Math.round(performance.now() - start);
      console.log(`\n[perf] cold-start write (${STRESS} files): ${elapsed} ms`);

      expect(result.exitCode, `write failed — stderr: ${result.stderr}`).toBe(0);
      const out = parseJsonOutput<{ ok: boolean; value: { file: string } }>(result.stdout);
      expect(out.ok).toBe(true);
      expect(out.value.file).toMatch(/context\.json$/);

      const raw = await readFile(
        join(repo.dir, ".ai", "local-context-gatherer_cache", "context.json"),
        "utf-8",
      );
      const ctx = parseJsonOutput<{
        tracked_files: unknown[];
        facts: Record<string, unknown>;
      }>(raw);
      expect(ctx.tracked_files).toHaveLength(STRESS);
      expect(Object.keys(ctx.facts)).toHaveLength(STRESS);

      expect(elapsed, `cold-start write exceeded 90 000 ms`).toBeLessThan(90_000);
    },
    120_000,
  );

  it(
    `delta write: 1 file against ${REALISTIC}-file cache — filterExistingFiles throughput`,
    async () => {
      await runDeltaWriteTest(repo, REALISTIC, 5_000);
    },
    60_000,
  );

  it(
    `delta write: 1 file against ${STRESS}-file cache — stress filterExistingFiles`,
    async () => {
      await runDeltaWriteTest(repo, STRESS, 15_000);
    },
    120_000,
  );
});

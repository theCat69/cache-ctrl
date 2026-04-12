import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, stat } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { listCommand } from "../../src/commands/list.js";
import { initGitRepo } from "../../e2e/helpers/repo.js";

const EXTERNAL_DIR = join(".ai", "external-context-gatherer_cache");
const LOCAL_DIR = join(".ai", "local-context-gatherer_cache");

function makeFetchedAt(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
}

async function setupCacheDir(repoRoot: string): Promise<void> {
  await mkdir(join(repoRoot, EXTERNAL_DIR), { recursive: true });
  await mkdir(join(repoRoot, LOCAL_DIR), { recursive: true });
}

let origCwd: string;
let tmpDir: string;

beforeEach(async () => {
  origCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "cache-ctrl-list-"));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(origCwd);
});

describe("listCommand", () => {
  it("returns all entries when agent=all", async () => {
    await setupCacheDir(tmpDir);
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "project-alpha.json"),
      JSON.stringify({
        subject: "project-alpha",
        description: "Alpha project docs",
        fetched_at: makeFetchedAt(1),
        sources: [],
      }),
    );
    await writeFile(
      join(tmpDir, LOCAL_DIR, "context.json"),
      JSON.stringify({
        timestamp: makeFetchedAt(2),
        topic: "local scan",
        description: "Local context",
        tracked_files: [],
      }),
    );

    const result = await listCommand({ agent: "all" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    const agents = result.value.map((e) => e.agent);
    expect(agents).toContain("external");
    expect(agents).toContain("local");
  });

  it("filters to external-only", async () => {
    await setupCacheDir(tmpDir);
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "alpha.json"),
      JSON.stringify({
        subject: "alpha",
        description: "desc",
        fetched_at: makeFetchedAt(1),
        sources: [],
      }),
    );
    await writeFile(
      join(tmpDir, LOCAL_DIR, "context.json"),
      JSON.stringify({
        timestamp: makeFetchedAt(1),
        topic: "local",
        description: "desc",
        tracked_files: [],
      }),
    );

    const result = await listCommand({ agent: "external" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.every((e) => e.agent === "external")).toBe(true);
  });

  it("filters to local-only", async () => {
    await setupCacheDir(tmpDir);
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "alpha.json"),
      JSON.stringify({
        subject: "alpha",
        description: "desc",
        fetched_at: makeFetchedAt(1),
        sources: [],
      }),
    );
    await writeFile(
      join(tmpDir, LOCAL_DIR, "context.json"),
      JSON.stringify({
        timestamp: makeFetchedAt(1),
        topic: "local",
        description: "desc",
        tracked_files: [],
      }),
    );

    const result = await listCommand({ agent: "local" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.every((e) => e.agent === "local")).toBe(true);
  });

  it("correctly computes age_human for recent entries", async () => {
    await setupCacheDir(tmpDir);
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "recent.json"),
      JSON.stringify({
        subject: "recent",
        description: "desc",
        fetched_at: makeFetchedAt(2),
        sources: [],
      }),
    );

    const result = await listCommand({ agent: "external" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.value[0]!;
    expect(entry.age_human).toContain("hour");
  });

  it("shows invalidated for empty fetched_at", async () => {
    await setupCacheDir(tmpDir);
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "invalid.json"),
      JSON.stringify({
        subject: "invalid",
        description: "desc",
        fetched_at: "",
        sources: [],
      }),
    );

    const result = await listCommand({ agent: "external" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.value[0]!;
    expect(entry.age_human).toBe("invalidated");
    expect(entry.is_stale).toBe(true);
  });

  it("marks external entries stale when age > 24h", async () => {
    await setupCacheDir(tmpDir);
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "old.json"),
      JSON.stringify({
        subject: "old",
        description: "desc",
        fetched_at: makeFetchedAt(25),
        sources: [],
      }),
    );

    const result = await listCommand({ agent: "external" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.is_stale).toBe(true);
  });

  it("marks fresh external entries as not stale", async () => {
    await setupCacheDir(tmpDir);
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "fresh.json"),
      JSON.stringify({
        subject: "fresh",
        description: "desc",
        fetched_at: makeFetchedAt(1),
        sources: [],
      }),
    );

    const result = await listCommand({ agent: "external" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.is_stale).toBe(false);
  });

  it("marks local entry as is_stale: false when nothing changed and tracked_files is empty", async () => {
    await setupCacheDir(tmpDir);
    await writeFile(
      join(tmpDir, LOCAL_DIR, "context.json"),
      JSON.stringify({
        timestamp: makeFetchedAt(0.1),
        topic: "recent local",
        description: "desc",
        tracked_files: [],
      }),
    );

    const result = await listCommand({ agent: "local" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.is_stale).toBe(false);
  });

  it("marks local entry as is_stale: false when tracked files are all unchanged", async () => {
    await setupCacheDir(tmpDir);
    const trackedPath = join(tmpDir, "tracked.ts");
    await writeFile(trackedPath, "export const x = 1;");
    const fileStat = await stat(trackedPath);
    const mtime = fileStat.mtimeMs;
    const hash = createHash("sha256").update("export const x = 1;").digest("hex");

    await writeFile(
      join(tmpDir, LOCAL_DIR, "context.json"),
      JSON.stringify({
        timestamp: makeFetchedAt(0.5),
        topic: "local scan",
        description: "desc",
        tracked_files: [{ path: "tracked.ts", mtime, hash }],
      }),
    );

    const result = await listCommand({ agent: "local" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.is_stale).toBe(false);
  });

  it("marks local entry as is_stale: true when a tracked file changed", async () => {
    await setupCacheDir(tmpDir);
    const trackedPath = join(tmpDir, "changed.ts");
    await writeFile(trackedPath, "export const x = 2;");

    await writeFile(
      join(tmpDir, LOCAL_DIR, "context.json"),
      JSON.stringify({
        timestamp: makeFetchedAt(0.5),
        topic: "local scan",
        description: "desc",
        tracked_files: [{ path: "changed.ts", mtime: 999_999_999 }],
      }),
    );

    const result = await listCommand({ agent: "local" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.is_stale).toBe(true);
  });

  it("marks local entry as is_stale: true when there are new files in a git repo", async () => {
    await setupCacheDir(tmpDir);
    initGitRepo(tmpDir);

    // Commit a tracked file so tracked_files is non-empty (enables new_files detection)
    const trackedPath = join(tmpDir, "tracked.ts");
    writeFileSync(trackedPath, "export const x = 1;");
    execFileSync("git", ["add", "."], { cwd: tmpDir });
    execFileSync("git", ["commit", "-m", "add tracked"], { cwd: tmpDir });
    const fileStat = await stat(trackedPath);
    const mtime = fileStat.mtimeMs;

    const newFile = join(tmpDir, "untracked.ts");
    writeFileSync(newFile, "export const y = 99;");
    // Deliberately NOT git-adding the file — it is untracked but non-ignored

    await writeFile(
      join(tmpDir, LOCAL_DIR, "context.json"),
      JSON.stringify({
        timestamp: makeFetchedAt(0.5),
        topic: "local scan",
        description: "desc",
        tracked_files: [{ path: "tracked.ts", mtime }],
      }),
    );

    const result = await listCommand({ agent: "local" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.is_stale).toBe(true);
  });

  it("marks local entry as is_stale: true when a tracked file is missing (documents error-fallback path)", async () => {
    // A tracked_files entry pointing to a nonexistent path causes checkFilesCommand to report
    // status: "changed" (via missing_files), which listCommand must surface as is_stale: true.
    await setupCacheDir(tmpDir);
    await writeFile(
      join(tmpDir, LOCAL_DIR, "context.json"),
      JSON.stringify({
        timestamp: makeFetchedAt(0.5),
        topic: "local scan",
        description: "desc",
        tracked_files: [{ path: "does-not-exist.ts", mtime: 0 }],
      }),
    );

    const result = await listCommand({ agent: "local" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.is_stale).toBe(true);
  });

  it("returns empty array when cache directories are empty", async () => {
    await setupCacheDir(tmpDir);

    const result = await listCommand({ agent: "all" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it("returns empty array when cache directories do not exist", async () => {
    const result = await listCommand({ agent: "all" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });
});

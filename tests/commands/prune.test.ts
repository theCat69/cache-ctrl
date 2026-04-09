import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneCommand } from "../../src/commands/prune.js";

const EXTERNAL_DIR = join(".ai", "external-context-gatherer_cache");
const LOCAL_DIR = join(".ai", "local-context-gatherer_cache");

let origCwd: string;
let tmpDir: string;

function makeTimestamp(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  origCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "cache-ctrl-prune-"));
  process.chdir(tmpDir);
  await mkdir(join(tmpDir, EXTERNAL_DIR), { recursive: true });
  await mkdir(join(tmpDir, LOCAL_DIR), { recursive: true });
});

afterEach(() => {
  process.chdir(origCwd);
});

describe("pruneCommand — external entries", () => {
  it("invalidates (zeros fetched_at) stale external entries by default", async () => {
    const staleFile = join(tmpDir, EXTERNAL_DIR, "stale-lib.json");
    const freshFile = join(tmpDir, EXTERNAL_DIR, "fresh-lib.json");

    await writeFile(
      staleFile,
      JSON.stringify({
        subject: "stale-lib",
        description: "Old library",
        fetched_at: makeTimestamp(30), // 30h old
        sources: [],
        header_metadata: {},
      }),
    );
    await writeFile(
      freshFile,
      JSON.stringify({
        subject: "fresh-lib",
        description: "Fresh library",
        fetched_at: makeTimestamp(1), // 1h old
        sources: [],
        header_metadata: {},
      }),
    );

    const result = await pruneCommand({ agent: "external" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.matched.map((m) => m.file)).toContain(staleFile);
    expect(result.value.matched.map((m) => m.file)).not.toContain(freshFile);
    expect(result.value.action).toBe("invalidated");

    // Stale file should still exist but with fetched_at zeroed
    const staleContent = JSON.parse(
      await (await import("node:fs/promises")).readFile(staleFile, "utf-8"),
    ) as Record<string, unknown>;
    expect(staleContent.fetched_at).toBe("");

    // Fresh file untouched
    const freshContent = JSON.parse(
      await (await import("node:fs/promises")).readFile(freshFile, "utf-8"),
    ) as Record<string, unknown>;
    expect(freshContent.fetched_at).not.toBe("");
  });

  it("deletes stale external entries when delete=true", async () => {
    const staleFile = join(tmpDir, EXTERNAL_DIR, "old.json");
    await writeFile(
      staleFile,
      JSON.stringify({
        subject: "old",
        description: "Old",
        fetched_at: makeTimestamp(50),
        sources: [],
        header_metadata: {},
      }),
    );

    const result = await pruneCommand({ agent: "external", delete: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.matched.map((m) => m.file)).toContain(staleFile);
    expect(result.value.action).toBe("deleted");
    expect(await fileExists(staleFile)).toBe(false);
  });

  it("respects custom maxAge duration", async () => {
    const file2h = join(tmpDir, EXTERNAL_DIR, "two-hours.json");
    const file5h = join(tmpDir, EXTERNAL_DIR, "five-hours.json");

    await writeFile(
      file2h,
      JSON.stringify({ subject: "two-hours", description: "2h old", fetched_at: makeTimestamp(2), sources: [], header_metadata: {} }),
    );
    await writeFile(
      file5h,
      JSON.stringify({ subject: "five-hours", description: "5h old", fetched_at: makeTimestamp(5), sources: [], header_metadata: {} }),
    );

    // maxAge=3h — only 5h entry should be pruned
    const result = await pruneCommand({ agent: "external", maxAge: "3h" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.matched.map((m) => m.file)).not.toContain(file2h);
    expect(result.value.matched.map((m) => m.file)).toContain(file5h);
  });

  it("rejects invalid maxAge format", async () => {
    const result = await pruneCommand({ agent: "external", maxAge: "5minutes" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_ARGS");
  });

  it("returns zero matched when all entries are fresh", async () => {
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "fresh.json"),
      JSON.stringify({ subject: "fresh", description: "Fresh", fetched_at: makeTimestamp(1), sources: [], header_metadata: {} }),
    );

    const result = await pruneCommand({ agent: "external" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.matched).toHaveLength(0);
    expect(result.value.count).toBe(0);
  });
});

describe("pruneCommand — local entry", () => {
  it("invalidates (zeros timestamp) local entry", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(
      localPath,
      JSON.stringify({
        timestamp: makeTimestamp(2),
        topic: "local scan",
        description: "Local context",
        tracked_files: [],
      }),
    );

    const result = await pruneCommand({ agent: "local" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.matched.map((m) => m.file)).toContain(localPath);
    expect(result.value.action).toBe("invalidated");

    const content = JSON.parse(
      await (await import("node:fs/promises")).readFile(localPath, "utf-8"),
    ) as Record<string, unknown>;
    expect(content.timestamp).toBe("");
  });

  it("deletes local entry when delete=true", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(
      localPath,
      JSON.stringify({ timestamp: makeTimestamp(2), topic: "scan", description: "d", tracked_files: [] }),
    );

    const result = await pruneCommand({ agent: "local", delete: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.matched.map((m) => m.file)).toContain(localPath);
    expect(await fileExists(localPath)).toBe(false);
  });

  it("returns zero matched when local cache does not exist and delete=false", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    const result = await pruneCommand({ agent: "local" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Local file did not exist — nothing to prune, nothing created
    expect(result.value.matched).toHaveLength(0);
    expect(await fileExists(localPath)).toBe(false);
  });

  it("returns zero matched for local when local cache does not exist and delete=true", async () => {
    const result = await pruneCommand({ agent: "local", delete: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.matched).toHaveLength(0);
  });
});

describe("pruneCommand — all agents", () => {
  it("prunes both external and local when agent=all", async () => {
    const staleFile = join(tmpDir, EXTERNAL_DIR, "old.json");
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");

    await writeFile(
      staleFile,
      JSON.stringify({ subject: "old", description: "Old", fetched_at: makeTimestamp(30), sources: [], header_metadata: {} }),
    );
    await writeFile(
      localPath,
      JSON.stringify({ timestamp: makeTimestamp(5), topic: "scan", description: "d", tracked_files: [] }),
    );

    const result = await pruneCommand({ agent: "all" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.matched.map((m) => m.file)).toContain(staleFile);
    expect(result.value.matched.map((m) => m.file)).toContain(localPath);
    expect(result.value.count).toBe(2);
  });
});

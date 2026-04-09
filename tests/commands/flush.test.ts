import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushCommand } from "../../src/commands/flush.js";

const EXTERNAL_DIR = join(".ai", "external-context-gatherer_cache");
const LOCAL_DIR = join(".ai", "local-context-gatherer_cache");

let origCwd: string;
let tmpDir: string;

beforeEach(async () => {
  origCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "cache-ctrl-flush-"));
  process.chdir(tmpDir);
  await mkdir(join(tmpDir, EXTERNAL_DIR), { recursive: true });
  await mkdir(join(tmpDir, LOCAL_DIR), { recursive: true });
});

afterEach(() => {
  process.chdir(origCwd);
});

describe("flushCommand", () => {
  it("refuses to flush without --confirm", async () => {
    const result = await flushCommand({ agent: "external", confirm: false });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CONFIRMATION_REQUIRED");
  });

  it("deletes all external files when agent=external", async () => {
    const file1 = join(tmpDir, EXTERNAL_DIR, "alpha.json");
    const file2 = join(tmpDir, EXTERNAL_DIR, "beta.json");
    await writeFile(file1, JSON.stringify({ subject: "alpha" }));
    await writeFile(file2, JSON.stringify({ subject: "beta" }));

    const result = await flushCommand({ agent: "external", confirm: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.count).toBe(2);
    expect(result.value.deleted).toContain(file1);
    expect(result.value.deleted).toContain(file2);

    await expect(stat(file1)).rejects.toThrow();
    await expect(stat(file2)).rejects.toThrow();
  });

  it("deletes local context.json when agent=local", async () => {
    const localFile = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(localFile, JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", topic: "test" }));

    const result = await flushCommand({ agent: "local", confirm: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deleted).toContain(localFile);

    await expect(stat(localFile)).rejects.toThrow();
  });

  it("deletes both when agent=all", async () => {
    const extFile = join(tmpDir, EXTERNAL_DIR, "alpha.json");
    const localFile = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(extFile, JSON.stringify({ subject: "alpha" }));
    await writeFile(localFile, JSON.stringify({ timestamp: "", topic: "test" }));

    const result = await flushCommand({ agent: "all", confirm: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.count).toBe(2);
  });

  it("does not delete .lock files", async () => {
    const extFile = join(tmpDir, EXTERNAL_DIR, "alpha.json");
    const lockFile = join(tmpDir, EXTERNAL_DIR, "alpha.json.lock");
    await writeFile(extFile, JSON.stringify({ subject: "alpha" }));
    await writeFile(lockFile, `${process.pid}\n`);

    const result = await flushCommand({ agent: "external", confirm: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deleted).not.toContain(lockFile);

    // Lock file should still exist
    const lockContent = await readFile(lockFile, "utf-8");
    expect(lockContent).toContain(`${process.pid}`);
  });

  it("returns correct deleted[] list", async () => {
    const file1 = join(tmpDir, EXTERNAL_DIR, "alpha.json");
    await writeFile(file1, JSON.stringify({ subject: "alpha" }));

    const result = await flushCommand({ agent: "external", confirm: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deleted).toEqual([file1]);
  });

  it("succeeds with empty result when no files exist", async () => {
    const result = await flushCommand({ agent: "external", confirm: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.count).toBe(0);
    expect(result.value.deleted).toHaveLength(0);
  });
});

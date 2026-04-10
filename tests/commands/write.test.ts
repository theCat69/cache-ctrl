import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, mkdir, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCommand } from "../../src/commands/write.js";
import { ErrorCode } from "../../src/types/result.js";

const EXTERNAL_DIR = join(".ai", "external-context-gatherer_cache");
const LOCAL_DIR = join(".ai", "local-context-gatherer_cache");

const validExternalContent = {
  subject: "mysubject",
  description: "A test external cache entry",
  fetched_at: "2026-04-05T10:00:00Z",
  sources: [{ type: "docs", url: "https://example.com/docs" }],
  header_metadata: {},
} as const;

const validLocalContent = {
  topic: "test local scan",
  description: "A test local cache entry",
  tracked_files: [{ path: "lua/plugins/ui/bufferline.lua" }],
} as const;

let origCwd: string;
let tmpDir: string;

beforeEach(async () => {
  origCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "cache-ctrl-write-"));
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(origCwd);
});

describe("writeCommand", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes a valid external entry", async () => {
    const result = await writeCommand({
      agent: "external",
      subject: "mysubject",
      content: { ...validExternalContent },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expectedPath = join(tmpDir, EXTERNAL_DIR, "mysubject.json");
    expect(result.value.file).toBe(expectedPath);

    const raw = await readFile(expectedPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["subject"]).toBe("mysubject");
    expect(parsed["description"]).toBe("A test external cache entry");
    expect(parsed["fetched_at"]).toBe("2026-04-05T10:00:00Z");
  });

  it("writes a valid local entry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T10:00:00.000Z"));

    const result = await writeCommand({
      agent: "local",
      content: { ...validLocalContent },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expectedPath = join(tmpDir, LOCAL_DIR, "context.json");
    expect(result.value.file).toBe(expectedPath);

    const raw = await readFile(expectedPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["timestamp"]).toBe("2026-04-05T10:00:00.000Z");
    expect(parsed["topic"]).toBe("test local scan");
  });

  it("ignores caller-provided timestamp and uses server-side time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T10:00:00.000Z"));

    const result = await writeCommand({
      agent: "local",
      content: { ...validLocalContent, timestamp: "1999-01-01T00:00:00.000Z" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["timestamp"]).toBe("2026-04-05T10:00:00.000Z");
  });

  it("second write updates timestamp and topic; top-level extra fields from first write are preserved by merge", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T10:00:00.000Z"));

    await writeCommand({
      agent: "local",
      content: { ...validLocalContent, extra_field: "preserved" },
    });

    vi.setSystemTime(new Date("2026-04-05T12:00:00.000Z"));

    const result = await writeCommand({
      agent: "local",
      content: { ...validLocalContent, topic: "updated topic" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["timestamp"]).toBe("2026-04-05T12:00:00.000Z");
    expect(parsed["topic"]).toBe("updated topic");
    // extra_field is preserved via top-level merge — second write does not include it,
    // so the existing value survives
    expect(parsed["extra_field"]).toBe("preserved");
  });

  it("auto-populates real mtime for tracked_files on local write", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T10:00:00.000Z"));

    // Create a real file to track
    const trackedPath = join(tmpDir, "some-real-file.ts");
    await writeFile(trackedPath, "export const x = 1;");
    const realStat = await stat(trackedPath);
    const realMtime = realStat.mtimeMs;

    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "mtime test",
        description: "testing mtime auto-pop",
        tracked_files: [{ path: trackedPath }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const files = parsed["tracked_files"] as Array<{ path: string; mtime: number; hash?: string }>;
    expect(files[0]?.mtime).toBe(realMtime);
    expect(files[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("evicts submitted entry for non-existent file (not added to tracked_files)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T10:00:00.000Z"));

    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "fallback mtime test",
        description: "testing fallback",
        tracked_files: [{ path: "nonexistent/file.ts" }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const files = parsed["tracked_files"] as Array<{ path: string; mtime: number; hash?: string }>;
    // Non-existent file is evicted — tracked_files should be empty
    expect(files).toHaveLength(0);
  });

  it("ignores caller-provided mtime and hash in tracked_files", async () => {
    const trackedPath = join(tmpDir, "real-file.ts");
    await writeFile(trackedPath, "export const z = 3;");
    const realStat = await stat(trackedPath);
    const realMtime = realStat.mtimeMs;

    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "strip test",
        description: "testing that caller mtime/hash are stripped",
        tracked_files: [{ path: trackedPath, mtime: 1, hash: "fakehash" }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const files = parsed["tracked_files"] as Array<{ path: string; mtime: number; hash?: string }>;
    expect(files[0]?.mtime).toBe(realMtime);
    expect(files[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(files[0]?.hash).not.toBe("fakehash");
  });

  it("returns VALIDATION_ERROR for missing required field (external)", async () => {
    // Missing 'description'
    const contentMissingDescription = {
      subject: "mysubject",
      fetched_at: "2026-04-05T10:00:00Z",
      sources: [],
      header_metadata: {},
    };

    const result = await writeCommand({
      agent: "external",
      subject: "mysubject",
      content: contentMissingDescription,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it("returns VALIDATION_ERROR for wrong field type (external)", async () => {
    // fetched_at must be string, passing number
    const contentWrongType = {
      subject: "mysubject",
      description: "A test entry",
      fetched_at: 123,
      sources: [],
      header_metadata: {},
    };

    const result = await writeCommand({
      agent: "external",
      subject: "mysubject",
      content: contentWrongType,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it("injects subject into content.subject when absent", async () => {
    // content does not have subject field
    const contentWithoutSubject = {
      description: "A test external cache entry",
      fetched_at: "2026-04-05T10:00:00Z",
      sources: [{ type: "docs", url: "https://example.com/docs" }],
      header_metadata: {},
    };

    const result = await writeCommand({
      agent: "external",
      subject: "injected-subject",
      content: contentWithoutSubject,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["subject"]).toBe("injected-subject");
  });

  it("returns VALIDATION_ERROR when content.subject mismatches subject param", async () => {
    const contentWithMismatch = {
      subject: "other",
      description: "A test entry",
      fetched_at: "2026-04-05T10:00:00Z",
      sources: [],
      header_metadata: {},
    };

    const result = await writeCommand({
      agent: "external",
      subject: "mysubject",
      content: contentWithMismatch,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(result.error).toContain("does not match subject argument");
  });

  it("returns INVALID_ARGS when subject missing for external", async () => {
    const result = await writeCommand({
      agent: "external",
      content: { ...validExternalContent },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.INVALID_ARGS);
  });

  it("preserves unknown extra fields", async () => {
    const contentWithExtra = {
      ...validExternalContent,
      extra_field: "hello",
      nested_extra: { foo: 42 },
    };

    const result = await writeCommand({
      agent: "external",
      subject: "mysubject",
      content: contentWithExtra,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["extra_field"]).toBe("hello");
    expect(parsed["nested_extra"]).toEqual({ foo: 42 });
  });

  it("merges with existing file on second write", async () => {
    // First write — full valid content
    await writeCommand({
      agent: "external",
      subject: "mysubject",
      content: { ...validExternalContent, existing_field: "original" },
    });

    // Second write — partial update (only update fetched_at, keep existing_field)
    const partialUpdate = {
      subject: "mysubject",
      description: "Updated description",
      fetched_at: "2026-04-06T10:00:00Z",
      sources: [],
      header_metadata: {},
    };

    const result = await writeCommand({
      agent: "external",
      subject: "mysubject",
      content: partialUpdate,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Updated fields from second write
    expect(parsed["description"]).toBe("Updated description");
    expect(parsed["fetched_at"]).toBe("2026-04-06T10:00:00Z");
    // Preserved from first write (merge semantics)
    expect(parsed["existing_field"]).toBe("original");
  });

  it("per-path preserve: write fileA then write only fileB → fileA entry is preserved", async () => {
    const fileA = join(tmpDir, "fileA.ts");
    const fileB = join(tmpDir, "fileB.ts");
    await writeFile(fileA, "export const a = 1;");
    await writeFile(fileB, "export const b = 2;");

    await writeCommand({
      agent: "local",
      content: {
        topic: "initial scan",
        description: "scan with fileA",
        tracked_files: [{ path: fileA }],
      },
    });

    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "incremental scan",
        description: "scan with fileB",
        tracked_files: [{ path: fileB }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const files = parsed["tracked_files"] as Array<{ path: string }>;
    const paths = files.map((f) => f.path);
    expect(paths).toContain(fileA);
    expect(paths).toContain(fileB);
  });

  it("per-path upsert: writing fileA twice updates the entry without duplicates", async () => {
    const fileA = join(tmpDir, "fileA-upsert.ts");
    await writeFile(fileA, "export const a = 1;");

    await writeCommand({
      agent: "local",
      content: {
        topic: "first write",
        description: "write fileA",
        tracked_files: [{ path: fileA }],
      },
    });

    // Modify the file so mtime changes
    await writeFile(fileA, "export const a = 2;");

    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "second write",
        description: "write fileA again",
        tracked_files: [{ path: fileA }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const files = parsed["tracked_files"] as Array<{ path: string }>;
    const matchingEntries = files.filter((f) => f.path === fileA);
    // Exactly one entry for fileA — no duplicates
    expect(matchingEntries).toHaveLength(1);
  });

  it("ENOENT eviction of existing: deletes fileB from disk, then writes fileC → fileB evicted, fileA and fileC survive", async () => {
    const fileA = join(tmpDir, "fileA-evict.ts");
    const fileB = join(tmpDir, "fileB-evict.ts");
    const fileC = join(tmpDir, "fileC-evict.ts");
    await writeFile(fileA, "export const a = 1;");
    await writeFile(fileB, "export const b = 2;");
    await writeFile(fileC, "export const c = 3;");

    // Write fileA and fileB to cache
    await writeCommand({
      agent: "local",
      content: {
        topic: "initial",
        description: "write A and B",
        tracked_files: [{ path: fileA }, { path: fileB }],
      },
    });

    // Delete fileB from disk
    await rm(fileB);

    // Now write only fileC — fileB should be evicted from existing entries
    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "after eviction",
        description: "write C only",
        tracked_files: [{ path: fileC }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const files = parsed["tracked_files"] as Array<{ path: string }>;
    const paths = files.map((f) => f.path);
    expect(paths).toContain(fileA);
    expect(paths).toContain(fileC);
    expect(paths).not.toContain(fileB);
  });

  it("top-level field merge: second write topic wins, first write topic is replaced", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T10:00:00.000Z"));

    await writeCommand({
      agent: "local",
      content: {
        topic: "old topic",
        description: "first write",
        tracked_files: [],
      },
    });

    vi.setSystemTime(new Date("2026-04-05T11:00:00.000Z"));

    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "new topic",
        description: "second write",
        tracked_files: [],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["topic"]).toBe("new topic");
  });

  it("existing loose fields preserved: second partial write does not remove extra foo field", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T10:00:00.000Z"));

    await writeCommand({
      agent: "local",
      content: {
        topic: "initial",
        description: "first write with foo",
        tracked_files: [],
        foo: "bar",
      },
    });

    vi.setSystemTime(new Date("2026-04-05T11:00:00.000Z"));

    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "update",
        description: "second write without foo",
        tracked_files: [],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // foo was set in the first write and not overridden in the second — should be preserved
    expect(parsed["foo"]).toBe("bar");
  });

  it("facts per-path merge: unsubmitted paths preserved in facts after delta write", async () => {
    const fileA = join(tmpDir, "facts-preserve-a.ts");
    const fileB = join(tmpDir, "facts-preserve-b.ts");
    await writeFile(fileA, "export const a = 1;");
    await writeFile(fileB, "export const b = 2;");

    // First write: submit both files with facts
    await writeCommand({
      agent: "local",
      content: {
        topic: "initial",
        description: "both files",
        tracked_files: [{ path: fileA }, { path: fileB }],
        facts: {
          [fileA]: ["fact about A"],
          [fileB]: ["fact about B"],
        },
      },
    });

    // Second write: submit only fileA — facts for fileB must be preserved
    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "delta",
        description: "only file A",
        tracked_files: [{ path: fileA }],
        facts: { [fileA]: ["updated fact about A"] },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const facts = parsed["facts"] as Record<string, string[]>;
    expect(facts[fileB]).toEqual(["fact about B"]);
    expect(facts[fileA]).toEqual(["updated fact about A"]);
  });

  it("facts per-path replace: submitted path overwrites existing facts for that path", async () => {
    const fileA = join(tmpDir, "facts-replace-a.ts");
    await writeFile(fileA, "export const a = 1;");

    await writeCommand({
      agent: "local",
      content: {
        topic: "first",
        description: "initial facts",
        tracked_files: [{ path: fileA }],
        facts: { [fileA]: ["original fact"] },
      },
    });

    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "second",
        description: "updated facts",
        tracked_files: [{ path: fileA }],
        facts: { [fileA]: ["replacement fact"] },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const facts = parsed["facts"] as Record<string, string[]>;
    expect(facts[fileA]).toEqual(["replacement fact"]);
  });

  it("facts eviction: facts for file deleted from disk are removed after next write", async () => {
    const fileA = join(tmpDir, "facts-evict-a.ts");
    const fileB = join(tmpDir, "facts-evict-b.ts");
    const fileC = join(tmpDir, "facts-evict-c.ts");
    await writeFile(fileA, "a");
    await writeFile(fileB, "b");
    await writeFile(fileC, "c");

    // Write all three files with facts
    await writeCommand({
      agent: "local",
      content: {
        topic: "initial",
        description: "all three",
        tracked_files: [{ path: fileA }, { path: fileB }],
        facts: {
          [fileA]: ["fact A"],
          [fileB]: ["fact B"],
        },
      },
    });

    // Delete fileB from disk
    await rm(fileB);

    // Write fileC — fileB should be evicted from facts
    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "after delete",
        description: "write C",
        tracked_files: [{ path: fileC }],
        facts: { [fileC]: ["fact C"] },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const facts = parsed["facts"] as Record<string, string[]>;
    expect(facts[fileA]).toEqual(["fact A"]);
    expect(facts[fileC]).toEqual(["fact C"]);
    expect(Object.keys(facts)).not.toContain(fileB);
  });

  it("facts empty after all tracked files deleted from disk", async () => {
    const fileA = join(tmpDir, "facts-empty-a.ts");
    const fileB = join(tmpDir, "facts-empty-b.ts");
    const fileC = join(tmpDir, "facts-empty-c.ts");
    await writeFile(fileA, "a");
    await writeFile(fileB, "b");
    await writeFile(fileC, "c");

    await writeCommand({
      agent: "local",
      content: {
        topic: "initial",
        description: "two files with facts",
        tracked_files: [{ path: fileA }, { path: fileB }],
        facts: { [fileA]: ["fact A"], [fileB]: ["fact B"] },
      },
    });

    await rm(fileA);
    await rm(fileB);

    // Write fileC with no facts — fileA and fileB evicted, leaving facts: {}
    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "after all deleted",
        description: "write C no facts",
        tracked_files: [{ path: fileC }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const facts = parsed["facts"] as Record<string, string[]>;
    expect(Object.keys(facts)).toHaveLength(0);
  });

  it("scope guard — pass: facts paths are a subset of submitted tracked_files", async () => {
    const fileA = join(tmpDir, "scope-pass-a.ts");
    await writeFile(fileA, "a");

    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "guard pass",
        description: "valid scope",
        tracked_files: [{ path: fileA }],
        facts: { [fileA]: ["fact"] },
      },
    });

    expect(result.ok).toBe(true);
  });

  it("scope guard — fail: facts contains path not in submitted tracked_files", async () => {
    const fileA = join(tmpDir, "scope-fail-a.ts");
    const fileB = join(tmpDir, "scope-fail-b.ts");
    await writeFile(fileA, "a");

    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "guard fail",
        description: "invalid scope",
        tracked_files: [{ path: fileA }],
        facts: { [fileB]: ["fact about B — not in tracked_files"] },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(result.error).toContain(fileB);
  });

  it("scope guard — pass: empty facts object always passes regardless of tracked_files", async () => {
    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "empty facts",
        description: "no facts submitted",
        tracked_files: [],
        facts: {},
      },
    });

    expect(result.ok).toBe(true);
  });

  it("scope guard — fail: non-empty facts with empty tracked_files returns VALIDATION_ERROR", async () => {
    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "guard fail empty tracked_files",
        description: "facts with no tracked_files",
        tracked_files: [],
        facts: { "a.ts": ["some fact"] },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(result.error).toContain("a.ts");
  });

  it("scope guard — pass: facts key absent means no validation occurs", async () => {
    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "no facts key",
        description: "facts field omitted entirely",
        tracked_files: [],
      },
    });

    expect(result.ok).toBe(true);
  });

  it("global_facts last-write-wins: submitted value replaces existing", async () => {
    await writeCommand({
      agent: "local",
      content: {
        topic: "first",
        description: "initial global_facts",
        tracked_files: [],
        global_facts: ["original global fact"],
      },
    });

    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "second",
        description: "updated global_facts",
        tracked_files: [],
        global_facts: ["new global fact"],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["global_facts"]).toEqual(["new global fact"]);
  });

  it("global_facts preserved when not submitted in second write", async () => {
    await writeCommand({
      agent: "local",
      content: {
        topic: "first",
        description: "sets global_facts",
        tracked_files: [],
        global_facts: ["preserved fact"],
      },
    });

    // Second write omits global_facts — must be preserved via top-level merge
    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "second",
        description: "no global_facts",
        tracked_files: [],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["global_facts"]).toEqual(["preserved fact"]);
  });

  it("corrupted tracked_files in existing cache is treated as empty (safeParse fallback)", async () => {
    // Pre-write a corrupted context.json with tracked_files: null
    const cacheDir = join(tmpDir, ".ai", "local-context-gatherer_cache");
    await mkdir(cacheDir, { recursive: true });
    const cachePath = join(cacheDir, "context.json");
    await writeFile(
      cachePath,
      JSON.stringify({
        topic: "corrupted",
        description: "has bad tracked_files",
        timestamp: "2026-01-01T00:00:00.000Z",
        tracked_files: null,
      }),
    );

    const trackedPath = join(tmpDir, "fresh-file.ts");
    await writeFile(trackedPath, "export const x = 1;");

    const result = await writeCommand({
      agent: "local",
      content: {
        topic: "recovery write",
        description: "write after corruption",
        tracked_files: [{ path: trackedPath }],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const raw = await readFile(result.value.file, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const files = parsed["tracked_files"] as Array<{ path: string }>;
    // Corrupted existing tracked_files treated as [] — only the newly submitted entry survives
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe(trackedPath);
  });

  describe("local schema constraints", () => {
    it("returns VALIDATION_ERROR when a fact string exceeds 800 chars", async () => {
      const trackedPath = join(tmpDir, "constraint-fact-len.ts");
      await writeFile(trackedPath, "export const x = 1;");

      const result = await writeCommand({
        agent: "local",
        content: {
          topic: "constraint test",
          description: "fact string over limit",
          tracked_files: [{ path: trackedPath }],
          facts: { [trackedPath]: ["a".repeat(801)] },
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(result.error).toMatch(/facts\./);
    });

    it("returns VALIDATION_ERROR when facts array for a file exceeds 30 entries", async () => {
      const trackedPath = join(tmpDir, "constraint-facts-count.ts");
      await writeFile(trackedPath, "export const x = 1;");

      const result = await writeCommand({
        agent: "local",
        content: {
          topic: "constraint test",
          description: "too many facts per file",
          tracked_files: [{ path: trackedPath }],
          facts: { [trackedPath]: Array.from({ length: 31 }, (_, i) => `fact ${i}`) },
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(result.error).toMatch(/facts\./);
    });

    it("returns VALIDATION_ERROR when a global_fact string exceeds 300 chars", async () => {
      const result = await writeCommand({
        agent: "local",
        content: {
          topic: "constraint test",
          description: "global fact string over limit",
          tracked_files: [],
          global_facts: ["g".repeat(301)],
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(result.error).toMatch(/global_facts/);
    });

    it("returns VALIDATION_ERROR when global_facts array exceeds 20 entries", async () => {
      const result = await writeCommand({
        agent: "local",
        content: {
          topic: "constraint test",
          description: "too many global facts",
          tracked_files: [],
          global_facts: Array.from({ length: 21 }, (_, i) => `global fact ${i}`),
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(result.error).toMatch(/global_facts/);
    });
  });
});

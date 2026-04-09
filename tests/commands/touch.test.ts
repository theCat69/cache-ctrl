import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { touchCommand } from "../../src/commands/touch.js";

const EXTERNAL_DIR = join(".ai", "external-context-gatherer_cache");
const LOCAL_DIR = join(".ai", "local-context-gatherer_cache");

let origCwd: string;
let tmpDir: string;

beforeEach(async () => {
  origCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "cache-ctrl-touch-"));
  process.chdir(tmpDir);
  await mkdir(join(tmpDir, EXTERNAL_DIR), { recursive: true });
  await mkdir(join(tmpDir, LOCAL_DIR), { recursive: true });
});

afterEach(() => {
  process.chdir(origCwd);
});

describe("touchCommand", () => {
  it("updates fetched_at to a recent ISO timestamp for a matched external entry", async () => {
    const filePath = join(tmpDir, EXTERNAL_DIR, "mylib.json");
    await writeFile(
      filePath,
      JSON.stringify({
        subject: "mylib",
        description: "My library docs",
        fetched_at: "2020-01-01T00:00:00Z",
        sources: [],
        header_metadata: {},
      }),
    );

    const before = Date.now();
    const result = await touchCommand({ agent: "external", subject: "mylib" });
    const after = Date.now();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.touched).toContain(filePath);

    const touchedAt = new Date(result.value.new_timestamp).getTime();
    expect(touchedAt).toBeGreaterThanOrEqual(before);
    expect(touchedAt).toBeLessThanOrEqual(after);

    const content = JSON.parse(await readFile(filePath, "utf-8")) as Record<string, unknown>;
    expect(content.fetched_at).toBe(result.value.new_timestamp);
  });

  it("updates timestamp for local entry", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(
      localPath,
      JSON.stringify({
        timestamp: "2020-01-01T00:00:00Z",
        topic: "local scan",
        description: "Local context",
        tracked_files: [],
      }),
    );

    const result = await touchCommand({ agent: "local" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.touched).toContain(localPath);

    const content = JSON.parse(await readFile(localPath, "utf-8")) as Record<string, unknown>;
    expect(content.timestamp).toBe(result.value.new_timestamp);
  });

  it("preserves all other fields after touch", async () => {
    const filePath = join(tmpDir, EXTERNAL_DIR, "mylib.json");
    const originalData = {
      subject: "mylib",
      description: "My library docs",
      fetched_at: "2020-01-01T00:00:00Z",
      sources: [{ type: "docs", url: "https://example.com" }],
      header_metadata: {},
      custom_field: "preserved",
    };
    await writeFile(filePath, JSON.stringify(originalData));

    const result = await touchCommand({ agent: "external", subject: "mylib" });
    expect(result.ok).toBe(true);

    const content = JSON.parse(await readFile(filePath, "utf-8")) as Record<string, unknown>;
    expect(content.description).toBe("My library docs");
    expect(content.custom_field).toBe("preserved");
    expect(Array.isArray(content.sources)).toBe(true);
    expect(content.fetched_at).not.toBe("2020-01-01T00:00:00Z");
  });

  it("returns NO_MATCH for unrecognized keyword", async () => {
    const result = await touchCommand({ agent: "external", subject: "nonexistent-entry" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NO_MATCH");
  });

  it("touches all external entries when no keyword provided", async () => {
    const file1 = join(tmpDir, EXTERNAL_DIR, "alpha.json");
    const file2 = join(tmpDir, EXTERNAL_DIR, "beta.json");
    await writeFile(
      file1,
      JSON.stringify({ subject: "alpha", description: "A", fetched_at: "2020-01-01T00:00:00Z", sources: [], header_metadata: {} }),
    );
    await writeFile(
      file2,
      JSON.stringify({ subject: "beta", description: "B", fetched_at: "2020-01-01T00:00:00Z", sources: [], header_metadata: {} }),
    );

    const result = await touchCommand({ agent: "external" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.touched).toHaveLength(2);

    const c1 = JSON.parse(await readFile(file1, "utf-8")) as Record<string, unknown>;
    const c2 = JSON.parse(await readFile(file2, "utf-8")) as Record<string, unknown>;
    expect(c1.fetched_at).toBe(result.value.new_timestamp);
    expect(c2.fetched_at).toBe(result.value.new_timestamp);
  });

  it("all touched entries receive the same new_timestamp", async () => {
    const file1 = join(tmpDir, EXTERNAL_DIR, "x.json");
    const file2 = join(tmpDir, EXTERNAL_DIR, "y.json");
    await writeFile(
      file1,
      JSON.stringify({ subject: "x", description: "X", fetched_at: "2020-01-01T00:00:00Z", sources: [], header_metadata: {} }),
    );
    await writeFile(
      file2,
      JSON.stringify({ subject: "y", description: "Y", fetched_at: "2020-01-01T00:00:00Z", sources: [], header_metadata: {} }),
    );

    const result = await touchCommand({ agent: "external" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const c1 = JSON.parse(await readFile(file1, "utf-8")) as Record<string, unknown>;
    const c2 = JSON.parse(await readFile(file2, "utf-8")) as Record<string, unknown>;
    expect(c1.fetched_at).toBe(result.value.new_timestamp);
    expect(c2.fetched_at).toBe(result.value.new_timestamp);
  });
});

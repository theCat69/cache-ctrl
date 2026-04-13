import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invalidateCommand } from "../../src/commands/invalidate.js";

const EXTERNAL_DIR = join(".ai", "external-context-gatherer_cache");
const LOCAL_DIR = join(".ai", "local-context-gatherer_cache");

let origCwd: string;
let tmpDir: string;

beforeEach(async () => {
  origCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "cache-ctrl-invalidate-"));
  process.chdir(tmpDir);
  await mkdir(join(tmpDir, EXTERNAL_DIR), { recursive: true });
  await mkdir(join(tmpDir, LOCAL_DIR), { recursive: true });
});

afterEach(() => {
  process.chdir(origCwd);
});

describe("invalidateCommand", () => {
  it("zeros out fetched_at for a matched external entry", async () => {
    const filePath = join(tmpDir, EXTERNAL_DIR, "project-docs.json");
    await writeFile(
      filePath,
      JSON.stringify({
        subject: "project-docs",
        description: "Project documentation",
        fetched_at: "2026-01-01T00:00:00Z",
        sources: [],
      }),
    );

    const result = await invalidateCommand({ agent: "external", subject: "project-docs" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.invalidated).toContain(filePath);

    const content = JSON.parse(await readFile(filePath, "utf-8")) as Record<string, unknown>;
    expect(content.fetched_at).toBe("");
  });

  it("zeros out timestamp for local entry", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(
      localPath,
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00Z",
        topic: "local scan",
        description: "Local context",
        tracked_files: [],
      }),
    );

    const result = await invalidateCommand({ agent: "local" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.invalidated).toContain(localPath);

    const content = JSON.parse(await readFile(localPath, "utf-8")) as Record<string, unknown>;
    expect(content.timestamp).toBe("");
  });

  it("also zeros out graph computed_at when graph.json exists for local invalidation", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    const graphPath = join(tmpDir, LOCAL_DIR, "graph.json");

    await writeFile(
      localPath,
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00Z",
        topic: "local scan",
        description: "Local context",
        tracked_files: [],
      }),
    );
    await writeFile(
      graphPath,
      JSON.stringify({
        files: {
          "src/index.ts": { rank: 1, deps: [], defs: ["main"] },
        },
        computed_at: "2026-01-01T00:00:00Z",
      }),
    );

    const result = await invalidateCommand({ agent: "local" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.invalidated).toContain(localPath);
    expect(result.value.invalidated).toContain(graphPath);

    const localContent = JSON.parse(await readFile(localPath, "utf-8")) as Record<string, unknown>;
    const graphContent = JSON.parse(await readFile(graphPath, "utf-8")) as Record<string, unknown>;
    expect(localContent.timestamp).toBe("");
    expect(graphContent.computed_at).toBe("");
  });

  it("does not throw when graph.json is missing and still invalidates local context", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(
      localPath,
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00Z",
        topic: "local scan",
        description: "Local context",
        tracked_files: [],
      }),
    );

    const result = await invalidateCommand({ agent: "local" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.invalidated).toContain(localPath);

    const localContent = JSON.parse(await readFile(localPath, "utf-8")) as Record<string, unknown>;
    expect(localContent.timestamp).toBe("");
  });

  it("preserves all other fields after invalidation", async () => {
    const filePath = join(tmpDir, EXTERNAL_DIR, "mylib.json");
    const originalData = {
      subject: "mylib",
      description: "My library docs",
      fetched_at: "2026-01-01T00:00:00Z",
      sources: [{ type: "docs", url: "https://example.com" }],
      custom_field: "preserved",
    };
    await writeFile(filePath, JSON.stringify(originalData));

    const result = await invalidateCommand({ agent: "external", subject: "mylib" });
    expect(result.ok).toBe(true);

    const content = JSON.parse(await readFile(filePath, "utf-8")) as Record<string, unknown>;
    expect(content.description).toBe("My library docs");
    expect(content.custom_field).toBe("preserved");
    expect(Array.isArray(content.sources)).toBe(true);
    expect(content.fetched_at).toBe("");
  });

  it("returns NO_MATCH for unrecognized keyword", async () => {
    const result = await invalidateCommand({ agent: "external", subject: "nonexistent-entry" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("NO_MATCH");
  });

  it("invalidates all external entries when no keyword provided", async () => {
    const file1 = join(tmpDir, EXTERNAL_DIR, "alpha.json");
    const file2 = join(tmpDir, EXTERNAL_DIR, "beta.json");
    await writeFile(
      file1,
      JSON.stringify({ subject: "alpha", description: "A", fetched_at: "2026-01-01T00:00:00Z", sources: [] }),
    );
    await writeFile(
      file2,
      JSON.stringify({ subject: "beta", description: "B", fetched_at: "2026-01-01T00:00:00Z", sources: [] }),
    );

    const result = await invalidateCommand({ agent: "external" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.invalidated).toHaveLength(2);

    const c1 = JSON.parse(await readFile(file1, "utf-8")) as Record<string, unknown>;
    const c2 = JSON.parse(await readFile(file2, "utf-8")) as Record<string, unknown>;
    expect(c1.fetched_at).toBe("");
    expect(c2.fetched_at).toBe("");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectCommand } from "../../src/commands/inspect.js";

const EXTERNAL_DIR = join(".ai", "external-context-gatherer_cache");
const LOCAL_DIR = join(".ai", "local-context-gatherer_cache");

let origCwd: string;
let tmpDir: string;

beforeEach(async () => {
  origCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "cache-ctrl-inspect-"));
  process.chdir(tmpDir);
  await mkdir(join(tmpDir, EXTERNAL_DIR), { recursive: true });
  await mkdir(join(tmpDir, LOCAL_DIR), { recursive: true });
});

afterEach(() => {
  process.chdir(origCwd);
});

describe("inspectCommand — external agent", () => {
  it("returns full file content for a matched external entry", async () => {
    const filePath = join(tmpDir, EXTERNAL_DIR, "mylib.json");
    const originalData = {
      subject: "mylib",
      description: "My library docs",
      fetched_at: "2026-01-01T00:00:00Z",
      sources: [{ type: "docs", url: "https://example.com" }],
      header_metadata: { "https://example.com": { checked_at: "2026-01-01T00:00:00Z", status: "fresh" } },
      extra_field: "custom value",
    };
    await writeFile(filePath, JSON.stringify(originalData));

    const result = await inspectCommand({ agent: "external", subject: "mylib" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.file).toBe(filePath);
    expect(result.value.agent).toBe("external");
    const value = result.value as Record<string, unknown>;
    expect(value.subject).toBe("mylib");
    expect(value.description).toBe("My library docs");
    expect(value.extra_field).toBe("custom value");
  });

  it("returns NO_MATCH for unrecognized keyword", async () => {
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "mylib.json"),
      JSON.stringify({
        subject: "mylib",
        description: "My library",
        fetched_at: "2026-01-01T00:00:00Z",
        sources: [],
        header_metadata: {},
      }),
    );

    const result = await inspectCommand({ agent: "external", subject: "completely-unrelated-xyz" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("FILE_NOT_FOUND");
  });

  it("returns FILE_NOT_FOUND when no external cache files exist", async () => {
    const result = await inspectCommand({ agent: "external", subject: "anything" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("FILE_NOT_FOUND");
  });

  it("returns AMBIGUOUS_MATCH when two entries score equally", async () => {
    // "mylib" matches stem "mylib-a" as substring (80) and subject "mylib" exactly (70) → score 80
    // "mylib" matches stem "mylib-b" as substring (80) and subject "mylib" exactly (70) → score 80
    // Both entries get identical scores → AMBIGUOUS_MATCH
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "mylib-a.json"),
      JSON.stringify({ subject: "mylib", description: "library docs", fetched_at: "2026-01-01T00:00:00Z", sources: [], header_metadata: {} }),
    );
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "mylib-b.json"),
      JSON.stringify({ subject: "mylib", description: "library docs", fetched_at: "2026-01-01T00:00:00Z", sources: [], header_metadata: {} }),
    );

    const result = await inspectCommand({ agent: "external", subject: "mylib" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("AMBIGUOUS_MATCH");
  });

  it("selects the best match when scores differ", async () => {
    // "react" in both subject and description scores higher
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "react-docs.json"),
      JSON.stringify({
        subject: "react-docs",
        description: "React documentation",
        fetched_at: "2026-01-01T00:00:00Z",
        sources: [],
        header_metadata: {},
      }),
    );
    // "unrelated" only in subject
    await writeFile(
      join(tmpDir, EXTERNAL_DIR, "unrelated.json"),
      JSON.stringify({
        subject: "unrelated",
        description: "Something else",
        fetched_at: "2026-01-01T00:00:00Z",
        sources: [],
        header_metadata: {},
      }),
    );

    const result = await inspectCommand({ agent: "external", subject: "react" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.file).toContain("react-docs.json");
  });
});

describe("inspectCommand — local agent", () => {
  it("returns full file content for the local cache", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    const localData = {
      timestamp: "2026-01-01T00:00:00Z",
      topic: "local codebase scan",
      description: "Scanned local project files",
      tracked_files: [{ path: "src/index.ts", mtime: 1_700_000_000_000 }],
    };
    await writeFile(localPath, JSON.stringify(localData));

    const result = await inspectCommand({ agent: "local", subject: "local" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.file).toBe(localPath);
    expect(result.value.agent).toBe("local");
    const value = result.value as Record<string, unknown>;
    expect(value.topic).toBe("local codebase scan");
    expect(value.tracked_files).toBeUndefined();
  });

  it("returns FILE_NOT_FOUND when local cache does not exist", async () => {
    const result = await inspectCommand({ agent: "local", subject: "local" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("FILE_NOT_FOUND");
  });
});

describe("inspectCommand — local agent filter", () => {
  it("strips tracked_files from local response regardless of filter", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(
      localPath,
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00Z",
        topic: "local",
        description: "test",
        tracked_files: [{ path: "src/index.ts", mtime: 1_700_000_000_000 }],
        facts: { "src/index.ts": ["entry point"] },
      }),
    );

    const result = await inspectCommand({ agent: "local", subject: "local" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as Record<string, unknown>;
    expect(value.tracked_files).toBeUndefined();
  });

  it("returns all facts when no filter provided", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(
      localPath,
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00Z",
        topic: "local",
        description: "test",
        tracked_files: [],
        facts: {
          "lua/plugins/lsp/config.lua": ["configures LSP servers"],
          "lua/plugins/ui/bufferline.lua": ["sets up tab bar"],
        },
      }),
    );

    const result = await inspectCommand({ agent: "local", subject: "local" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as Record<string, unknown>;
    const facts = value.facts as Record<string, string[]>;
    expect(Object.keys(facts)).toHaveLength(2);
  });

  it("filters facts by path keyword (single keyword)", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(
      localPath,
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00Z",
        topic: "local",
        description: "test",
        tracked_files: [],
        facts: {
          "lua/plugins/lsp/config.lua": ["configures LSP servers"],
          "lua/plugins/ui/bufferline.lua": ["sets up tab bar"],
          "lua/plugins/lsp/servers.lua": ["server list"],
        },
      }),
    );

    const result = await inspectCommand({ agent: "local", subject: "local", filter: ["lsp"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as Record<string, unknown>;
    const facts = value.facts as Record<string, string[]>;
    expect(Object.keys(facts)).toHaveLength(2);
    expect(facts["lua/plugins/lsp/config.lua"]).toBeDefined();
    expect(facts["lua/plugins/lsp/servers.lua"]).toBeDefined();
    expect(facts["lua/plugins/ui/bufferline.lua"]).toBeUndefined();
  });

  it("filters facts by path keyword (multiple keywords — OR logic)", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(
      localPath,
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00Z",
        topic: "local",
        description: "test",
        tracked_files: [],
        facts: {
          "lua/plugins/lsp/config.lua": ["configures LSP"],
          "lua/plugins/ui/bufferline.lua": ["tab bar"],
          ".zshrc": ["shell config"],
        },
      }),
    );

    const result = await inspectCommand({
      agent: "local",
      subject: "local",
      filter: ["lsp", "zsh"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as Record<string, unknown>;
    const facts = value.facts as Record<string, string[]>;
    expect(Object.keys(facts)).toHaveLength(2);
    expect(facts["lua/plugins/lsp/config.lua"]).toBeDefined();
    expect(facts[".zshrc"]).toBeDefined();
    expect(facts["lua/plugins/ui/bufferline.lua"]).toBeUndefined();
  });

  it("filter is case-insensitive", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(
      localPath,
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00Z",
        topic: "local",
        description: "test",
        tracked_files: [],
        facts: {
          "lua/plugins/LSP/config.lua": ["LSP config"],
          "lua/plugins/ui/bufferline.lua": ["tab bar"],
        },
      }),
    );

    const result = await inspectCommand({ agent: "local", subject: "local", filter: ["lsp"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as Record<string, unknown>;
    const facts = value.facts as Record<string, string[]>;
    expect(Object.keys(facts)).toHaveLength(1);
    expect(facts["lua/plugins/LSP/config.lua"]).toBeDefined();
  });

  it("returns empty facts object when filter matches nothing", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(
      localPath,
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00Z",
        topic: "local",
        description: "test",
        tracked_files: [],
        facts: {
          "lua/plugins/lsp/config.lua": ["LSP config"],
        },
      }),
    );

    const result = await inspectCommand({
      agent: "local",
      subject: "local",
      filter: ["nonexistent-keyword-xyz"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as Record<string, unknown>;
    const facts = value.facts as Record<string, string[]>;
    expect(Object.keys(facts)).toHaveLength(0);
  });

  it("always includes global_facts regardless of filter", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(
      localPath,
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00Z",
        topic: "local",
        description: "test",
        tracked_files: [],
        global_facts: ["Uses lazy.nvim for plugin management"],
        facts: {
          "lua/plugins/lsp/config.lua": ["LSP config"],
        },
      }),
    );

    const result = await inspectCommand({ agent: "local", subject: "local", filter: ["zsh"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as Record<string, unknown>;
    expect(Array.isArray(value.global_facts)).toBe(true);
    const gf = value.global_facts as string[];
    expect(gf[0]).toBe("Uses lazy.nvim for plugin management");
  });

  it("filter has no effect on external agent", async () => {
    const filePath = join(tmpDir, EXTERNAL_DIR, "mylib.json");
    await writeFile(
      filePath,
      JSON.stringify({
        subject: "mylib",
        description: "My library docs",
        fetched_at: "2026-01-01T00:00:00Z",
        sources: [],
        header_metadata: {},
      }),
    );

    // filter is silently ignored for external agent — full content returned
    const result = await inspectCommand({ agent: "external", subject: "mylib", filter: ["lsp"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as Record<string, unknown>;
    expect(value.subject).toBe("mylib");
  });

  it("handles local entry with no facts field — returns without facts key", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(localPath, JSON.stringify({
      timestamp: "2026-01-01T00:00:00Z",
      topic: "local",
      description: "no facts test",
      tracked_files: [],
      // deliberately omit facts
    }));

    const result = await inspectCommand({ agent: "local", subject: "local" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as Record<string, unknown>;
    expect(value.facts).toBeUndefined();
    expect(value.tracked_files).toBeUndefined();
  });

  it("handles local entry with no facts field — filter provided, still no error", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(localPath, JSON.stringify({
      timestamp: "2026-01-01T00:00:00Z",
      topic: "local",
      description: "no facts filter test",
      tracked_files: [],
    }));

    const result = await inspectCommand({ agent: "local", subject: "local", filter: ["lsp"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as Record<string, unknown>;
    expect(value.facts).toBeUndefined();
  });

  it("empty filter array behaves identically to no filter", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(localPath, JSON.stringify({
      timestamp: "2026-01-01T00:00:00Z",
      topic: "local",
      description: "empty filter test",
      tracked_files: [],
      facts: {
        "lua/plugins/lsp/config.lua": ["LSP config"],
        "lua/plugins/ui/bufferline.lua": ["tab bar"],
      },
    }));

    const resultNoFilter = await inspectCommand({ agent: "local", subject: "local" });
    const resultEmptyFilter = await inspectCommand({ agent: "local", subject: "local", filter: [] });
    expect(resultNoFilter.ok).toBe(true);
    expect(resultEmptyFilter.ok).toBe(true);
    if (!resultNoFilter.ok || !resultEmptyFilter.ok) return;
    const noFilterFacts = (resultNoFilter.value as Record<string, unknown>).facts as Record<string, string[]>;
    const emptyFilterFacts = (resultEmptyFilter.value as Record<string, unknown>).facts as Record<string, string[]>;
    expect(Object.keys(emptyFilterFacts)).toHaveLength(Object.keys(noFilterFacts).length);
  });
});

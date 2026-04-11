import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectCommand } from "../../src/commands/inspect.js";
import type { FileFacts } from "../../src/types/cache.js";
import { ErrorCode } from "../../src/types/result.js";

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
        facts: { "src/index.ts": { facts: ["entry point"] } },
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
          "lua/plugins/lsp/config.lua": { facts: ["configures LSP servers"] },
          "lua/plugins/ui/bufferline.lua": { facts: ["sets up tab bar"] },
        },
      }),
    );

    const result = await inspectCommand({ agent: "local", subject: "local" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as Record<string, unknown>;
    const facts = value.facts as Record<string, FileFacts>;
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
          "lua/plugins/lsp/config.lua": { facts: ["configures LSP servers"] },
          "lua/plugins/ui/bufferline.lua": { facts: ["sets up tab bar"] },
          "lua/plugins/lsp/servers.lua": { facts: ["server list"] },
        },
      }),
    );

    const result = await inspectCommand({ agent: "local", subject: "local", filter: ["lsp"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as Record<string, unknown>;
    const facts = value.facts as Record<string, FileFacts>;
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
          "lua/plugins/lsp/config.lua": { facts: ["configures LSP"] },
          "lua/plugins/ui/bufferline.lua": { facts: ["tab bar"] },
          ".zshrc": { facts: ["shell config"] },
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
    const facts = value.facts as Record<string, FileFacts>;
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
          "lua/plugins/LSP/config.lua": { facts: ["LSP config"] },
          "lua/plugins/ui/bufferline.lua": { facts: ["tab bar"] },
        },
      }),
    );

    const result = await inspectCommand({ agent: "local", subject: "local", filter: ["lsp"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as Record<string, unknown>;
    const facts = value.facts as Record<string, FileFacts>;
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
          "lua/plugins/lsp/config.lua": { facts: ["LSP config"] },
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
    const facts = value.facts as Record<string, FileFacts>;
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
          "lua/plugins/lsp/config.lua": { facts: ["LSP config"] },
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
        "lua/plugins/lsp/config.lua": { facts: ["LSP config"] },
        "lua/plugins/ui/bufferline.lua": { facts: ["tab bar"] },
      },
    }));

    const resultNoFilter = await inspectCommand({ agent: "local", subject: "local" });
    const resultEmptyFilter = await inspectCommand({ agent: "local", subject: "local", filter: [] });
    expect(resultNoFilter.ok).toBe(true);
    expect(resultEmptyFilter.ok).toBe(true);
    if (!resultNoFilter.ok || !resultEmptyFilter.ok) return;
    const noFilterFacts = (resultNoFilter.value as Record<string, unknown>).facts as Record<string, FileFacts>;
    const emptyFilterFacts = (resultEmptyFilter.value as Record<string, unknown>).facts as Record<string, FileFacts>;
    expect(Object.keys(emptyFilterFacts)).toHaveLength(Object.keys(noFilterFacts).length);
  });
});

/** Shared fixture for folder and search-facts filter tests. */
async function writeFilterFixture(localDir: string): Promise<void> {
  const localPath = join(localDir, "context.json");
  await writeFile(
    localPath,
    JSON.stringify({
      timestamp: "2026-01-01T00:00:00Z",
      topic: "local",
      description: "folder and search-facts filter test",
      tracked_files: [
        { path: "src/commands/write.ts", mtime: 1_700_000_000_000, hash: "aaa" },
        { path: "src/commands/inspect.ts", mtime: 1_700_000_000_001, hash: "bbb" },
        { path: "src/commands/nested/util.ts", mtime: 1_700_000_000_002, hash: "ccc" },
        { path: "src/cache/cacheManager.ts", mtime: 1_700_000_000_003, hash: "ddd" },
        { path: "src/utils/validate.ts", mtime: 1_700_000_000_004, hash: "eee" },
      ],
      facts: {
        "src/commands/write.ts": { facts: ["Exports writeCommand", "uses Result pattern"] },
        "src/commands/inspect.ts": { facts: ["Exports inspectCommand", "handles errors gracefully"] },
        "src/commands/nested/util.ts": { facts: ["Utility helpers for commands"] },
        "src/cache/cacheManager.ts": { facts: ["Exports findRepoRoot", "advisory locking"] },
        "src/utils/validate.ts": { facts: ["Exports validateSubject", "uses Result pattern"] },
      },
    }),
  );
}

describe("folder and search-facts filters", () => {
  it("--folder 'src/commands' returns only files under src/commands/ (not src/cache/ or src/utils/)", async () => {
    await writeFilterFixture(join(tmpDir, LOCAL_DIR));

    const result = await inspectCommand({ agent: "local", subject: "local", folder: "src/commands" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = (result.value as Record<string, unknown>).facts as Record<string, FileFacts>;
    expect(facts["src/commands/write.ts"]).toBeDefined();
    expect(facts["src/commands/inspect.ts"]).toBeDefined();
    expect(facts["src/commands/nested/util.ts"]).toBeDefined();
    expect(facts["src/cache/cacheManager.ts"]).toBeUndefined();
    expect(facts["src/utils/validate.ts"]).toBeUndefined();
  });

  it("--folder 'src/commands' includes deeply nested subpaths (src/commands/nested/util.ts)", async () => {
    await writeFilterFixture(join(tmpDir, LOCAL_DIR));

    const result = await inspectCommand({ agent: "local", subject: "local", folder: "src/commands" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = (result.value as Record<string, unknown>).facts as Record<string, FileFacts>;
    expect(facts["src/commands/nested/util.ts"]).toBeDefined();
  });

  it("--folder + --filter are AND-ed: folder narrows first, then filter applies on remaining", async () => {
    await writeFilterFixture(join(tmpDir, LOCAL_DIR));

    const result = await inspectCommand({
      agent: "local",
      subject: "local",
      folder: "src/commands",
      filter: ["inspect"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = (result.value as Record<string, unknown>).facts as Record<string, FileFacts>;
    expect(facts["src/commands/inspect.ts"]).toBeDefined();
    expect(facts["src/commands/write.ts"]).toBeUndefined();
    expect(facts["src/commands/nested/util.ts"]).toBeUndefined();
    expect(facts["src/cache/cacheManager.ts"]).toBeUndefined();
  });

  it("--folder with no matching files returns empty facts object (ok: true, not an error)", async () => {
    const localPath = join(tmpDir, LOCAL_DIR, "context.json");
    await writeFile(
      localPath,
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00Z",
        topic: "local",
        description: "commands-only fixture",
        tracked_files: [
          { path: "src/commands/write.ts", mtime: 1_700_000_000_000, hash: "aaa" },
          { path: "src/commands/inspect.ts", mtime: 1_700_000_000_001, hash: "bbb" },
        ],
        facts: {
          "src/commands/write.ts": { facts: ["Exports writeCommand"] },
          "src/commands/inspect.ts": { facts: ["Exports inspectCommand"] },
        },
      }),
    );

    // --folder "src/cache" matches nothing in a fixture that only has src/commands/ files
    const result = await inspectCommand({ agent: "local", subject: "local", folder: "src/cache" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = (result.value as Record<string, unknown>).facts as Record<string, FileFacts>;
    expect(Object.keys(facts)).toHaveLength(0);
  });

  it("--folder value containing '..' returns INVALID_ARGS", async () => {
    await writeFilterFixture(join(tmpDir, LOCAL_DIR));

    const result = await inspectCommand({ agent: "local", subject: "local", folder: "../etc" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.INVALID_ARGS);
  });

  it("--folder with agent 'external' returns INVALID_ARGS", async () => {
    const filePath = join(tmpDir, EXTERNAL_DIR, "context.json");
    await writeFile(
      filePath,
      JSON.stringify({
        subject: "context",
        description: "external entry",
        fetched_at: "2026-01-01T00:00:00Z",
        sources: [],
        header_metadata: {},
      }),
    );

    const result = await inspectCommand({ agent: "external", subject: "context", folder: "src/commands" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.INVALID_ARGS);
  });

  it("--search-facts matches a keyword found in fact strings (not in file path)", async () => {
    await writeFilterFixture(join(tmpDir, LOCAL_DIR));

    const result = await inspectCommand({ agent: "local", subject: "local", searchFacts: ["Result pattern"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = (result.value as Record<string, unknown>).facts as Record<string, FileFacts>;
    // Both write.ts and validate.ts have "uses Result pattern" fact
    expect(facts["src/commands/write.ts"]).toBeDefined();
    expect(facts["src/utils/validate.ts"]).toBeDefined();
    // cacheManager.ts does not have "Result pattern" in its facts
    expect(facts["src/cache/cacheManager.ts"]).toBeUndefined();
  });

  it("--search-facts is case-insensitive (lowercase keyword matches mixed-case fact)", async () => {
    await writeFilterFixture(join(tmpDir, LOCAL_DIR));

    const result = await inspectCommand({ agent: "local", subject: "local", searchFacts: ["result pattern"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = (result.value as Record<string, unknown>).facts as Record<string, FileFacts>;
    expect(facts["src/commands/write.ts"]).toBeDefined();
    expect(facts["src/utils/validate.ts"]).toBeDefined();
    expect(facts["src/cache/cacheManager.ts"]).toBeUndefined();
  });

  it("--folder + --search-facts are AND-ed: folder first, then search-facts within", async () => {
    await writeFilterFixture(join(tmpDir, LOCAL_DIR));

    const result = await inspectCommand({
      agent: "local",
      subject: "local",
      folder: "src/commands",
      searchFacts: ["Result pattern"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = (result.value as Record<string, unknown>).facts as Record<string, FileFacts>;
    // Only write.ts is under src/commands AND has "Result pattern" in facts
    expect(facts["src/commands/write.ts"]).toBeDefined();
    // validate.ts has "Result pattern" but is NOT under src/commands
    expect(facts["src/utils/validate.ts"]).toBeUndefined();
    // inspect.ts is under src/commands but does NOT have "Result pattern" in facts
    expect(facts["src/commands/inspect.ts"]).toBeUndefined();
  });

  it("--filter (path keyword only) matches file path, not fact content — regression check", async () => {
    await writeFilterFixture(join(tmpDir, LOCAL_DIR));

    // --filter "write" matches only src/commands/write.ts (path contains "write")
    // validate.ts also has "uses Result pattern" fact but its path does NOT contain "write"
    const result = await inspectCommand({ agent: "local", subject: "local", filter: ["write"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = (result.value as Record<string, unknown>).facts as Record<string, FileFacts>;
    expect(facts["src/commands/write.ts"]).toBeDefined();
    expect(facts["src/utils/validate.ts"]).toBeUndefined();
    expect(facts["src/commands/inspect.ts"]).toBeUndefined();
    expect(facts["src/cache/cacheManager.ts"]).toBeUndefined();
  });
});

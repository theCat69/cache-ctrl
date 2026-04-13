import { describe, it, expect, beforeEach, vi } from "vitest";
import { join } from "node:path";

const readFileMock = vi.fn();
const readdirMock = vi.fn();
const statMock = vi.fn();
const writeFileMock = vi.fn();
const renameMock = vi.fn();
const unlinkMock = vi.fn();
const mkdirMock = vi.fn();
const openMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
  readdir: readdirMock,
  stat: statMock,
  writeFile: writeFileMock,
  rename: renameMock,
  unlink: unlinkMock,
  mkdir: mkdirMock,
  open: openMock,
}));

import { inspectExternalCommand } from "../../src/commands/inspectExternal.js";
import { inspectLocalCommand } from "../../src/commands/inspectLocal.js";
import { ErrorCode } from "../../src/types/result.js";

const externalFixtureBase = {
  description: "A test external cache entry",
  fetched_at: "2026-01-01T00:00:00Z",
  sources: [{ type: "docs", url: "https://example.com/docs" }],
};

const localFixtureBase = {
  timestamp: "2026-01-01T00:00:00Z",
  topic: "test local scan",
  description: "A test local cache entry",
  tracked_files: [{ path: "test-file.ts", mtime: 1735689600000, hash: "abc123def456" }],
};

function mockRepoRootDetection(): void {
  statMock.mockImplementation(async (path: string) => {
    if (path.endsWith("/.git")) return { mtimeMs: Date.now() };
    const err = new Error("ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    throw err;
  });
}

function externalDir(): string {
  return join(process.cwd(), ".ai", "external-context-gatherer_cache");
}

function localPath(): string {
  return join(process.cwd(), ".ai", "local-context-gatherer_cache", "context.json");
}

function buildLargeFacts(): Record<string, { facts: string[] }> {
  return Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => {
      const entryIndex = (index + 1).toString().padStart(3, "0");
      return [
        `src/generated/file-${entryIndex}.ts`,
        {
          facts: Array.from({ length: 10 }, (__, factIndex) => `fact-${factIndex + 1}-${"x".repeat(60)}`),
        },
      ];
    }),
  );
}

describe("inspectExternalCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepoRootDetection();
  });

  it("returns INVALID_ARGS when subject fails validation", async () => {
    const result = await inspectExternalCommand({ subject: "foo/bar" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.INVALID_ARGS);
  });

  it("selects the best-matching external entry", async () => {
    readdirMock.mockResolvedValue(["react-docs.json", "unrelated.json"]);
    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith("react-docs.json")) {
        return JSON.stringify({ subject: "react-docs", ...externalFixtureBase, description: "React documentation" });
      }
      if (path.endsWith("unrelated.json")) {
        return JSON.stringify({ subject: "unrelated", ...externalFixtureBase, description: "Something else" });
      }
      throw new Error(`unexpected read path: ${path}`);
    });

    const result = await inspectExternalCommand({ subject: "react" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.agent).toBe("external");
    expect(result.value.file).toBe(join(externalDir(), "react-docs.json"));
    expect(result.value.subject).toBe("react-docs");
  });

  it("returns AMBIGUOUS_MATCH when two entries tie", async () => {
    readdirMock.mockResolvedValue(["mylib-a.json", "mylib-b.json"]);
    readFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith("mylib-a.json") || path.endsWith("mylib-b.json")) {
        return JSON.stringify({ subject: "mylib", ...externalFixtureBase });
      }
      throw new Error(`unexpected read path: ${path}`);
    });

    const result = await inspectExternalCommand({ subject: "mylib" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.AMBIGUOUS_MATCH);
  });

  it("returns NO_MATCH when no keyword matches", async () => {
    readdirMock.mockResolvedValue(["sample.json"]);
    readFileMock.mockResolvedValue(JSON.stringify({ subject: "sample", ...externalFixtureBase }));

    const result = await inspectExternalCommand({ subject: "missing-keyword" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.NO_MATCH);
  });

  it("returns NO_MATCH when there are no external entries", async () => {
    readdirMock.mockResolvedValue([]);

    const result = await inspectExternalCommand({ subject: "anything" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.NO_MATCH);
  });
});

describe("inspectLocalCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepoRootDetection();
  });

  it("returns full facts when no filters are provided", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        ...localFixtureBase,
        global_facts: ["test repo", "TypeScript project"],
        facts: {
          "src/file-a.ts": { facts: ["exports fetchUser"] },
          "src/file-b.ts": { facts: ["exports validateInput"] },
        },
      }),
    );

    const result = await inspectLocalCommand({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.agent).toBe("local");
    expect(result.value.file).toBe(localPath());
    expect(result.value.tracked_files).toBeUndefined();
    expect(Object.keys(result.value.facts ?? {})).toEqual(["src/file-a.ts", "src/file-b.ts"]);
  });

  it("narrows facts by filter path keyword (case-insensitive)", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        ...localFixtureBase,
        facts: {
          "src/plugins/LSP/config.ts": { facts: ["configures servers"] },
          "src/plugins/ui/bufferline.ts": { facts: ["tab bar"] },
        },
      }),
    );

    const result = await inspectLocalCommand({ filter: ["lsp"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.value.facts ?? {})).toEqual(["src/plugins/LSP/config.ts"]);
  });

  it("narrows facts by folder prefix", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        ...localFixtureBase,
        facts: {
          "src/commands/a.ts": { facts: ["a"] },
          "src/commands/nested/b.ts": { facts: ["b"] },
          "src/cache/c.ts": { facts: ["c"] },
        },
      }),
    );

    const result = await inspectLocalCommand({ folder: "src/commands" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.value.facts ?? {})).toEqual(["src/commands/a.ts", "src/commands/nested/b.ts"]);
  });

  it("narrows facts by searchFacts content", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        ...localFixtureBase,
        facts: {
          "src/a.ts": { facts: ["uses advisory locking"] },
          "src/b.ts": { facts: ["plain utility"] },
        },
      }),
    );

    const result = await inspectLocalCommand({ searchFacts: ["Advisory"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.value.facts ?? {})).toEqual(["src/a.ts"]);
  });

  it("applies filter, folder, and searchFacts with AND semantics", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        ...localFixtureBase,
        facts: {
          "src/file-a.ts": { facts: ["uses advisory locking"] },
          "src/file-b.ts": { facts: ["reads entries"] },
          "docs/file-a.md": { facts: ["uses advisory locking"] },
        },
      }),
    );

    const result = await inspectLocalCommand({ folder: "src", filter: ["file-a"], searchFacts: ["advisory"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.value.facts ?? {})).toEqual(["src/file-a.ts"]);
  });

  it("returns ok:true with empty facts when filters match nothing", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        ...localFixtureBase,
        facts: {
          "src/file-a.ts": { facts: ["exports fetchUser"] },
        },
      }),
    );

    const result = await inspectLocalCommand({ filter: ["nope"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.facts).toEqual({});
  });

  it("returns ok:true for unfiltered facts under the byte limit", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        ...localFixtureBase,
        facts: {
          "src/a.ts": { facts: ["exports foo", "uses zod"] },
          "src/b.ts": { facts: ["exports bar"] },
        },
      }),
    );

    const result = await inspectLocalCommand({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.facts).toEqual({
      "src/a.ts": { facts: ["exports foo", "uses zod"] },
      "src/b.ts": { facts: ["exports bar"] },
    });
  });

  it("returns PAYLOAD_TOO_LARGE when unfiltered facts exceed the byte limit", async () => {
    const largeFacts = buildLargeFacts();

    readFileMock.mockResolvedValue(
      JSON.stringify({
        ...localFixtureBase,
        facts: largeFacts,
      }),
    );

    const result = await inspectLocalCommand({});
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe(ErrorCode.PAYLOAD_TOO_LARGE);
    expect(result.error).toMatch(/filter/i);
  });

  it("returns large filtered result without PAYLOAD_TOO_LARGE", async () => {
    const largeFacts = buildLargeFacts();

    readFileMock.mockResolvedValue(
      JSON.stringify({
        ...localFixtureBase,
        facts: largeFacts,
      }),
    );

    const result = await inspectLocalCommand({ filter: ["src/generated/file-"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.facts).toBeDefined();
  });

  it("returns FILE_NOT_FOUND when context.json is missing", async () => {
    const enoent = new Error("not found") as NodeJS.ErrnoException;
    enoent.code = "ENOENT";
    readFileMock.mockRejectedValue(enoent);

    const result = await inspectLocalCommand({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.FILE_NOT_FOUND);
  });

  it("returns PARSE_ERROR when context.json is malformed", async () => {
    readFileMock.mockResolvedValue("{not-json");

    const result = await inspectLocalCommand({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.PARSE_ERROR);
  });

  it("returns PARSE_ERROR when context.json fails local schema validation", async () => {
    readFileMock.mockResolvedValue(JSON.stringify({ foo: "bar" }));

    const result = await inspectLocalCommand({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.PARSE_ERROR);
  });

  it("returns INVALID_ARGS when folder contains '..'", async () => {
    const result = await inspectLocalCommand({ folder: "../etc" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.INVALID_ARGS);
  });
});

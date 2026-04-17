import { describe, expect, it, vi } from "vitest";
import { appendFile, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createRecursiveFileWatcher,
  rebuildGraphCache,
  serializeGraphToCache,
  isSourceFile,
  resolveSourceFilePaths,
  watchCommand,
} from "../../src/commands/watch.js";
import type { DependencyGraph } from "../../src/analysis/graphBuilder.js";
import type { Result } from "../../src/types/result.js";
import { ErrorCode } from "../../src/types/result.js";

describe("watch helpers", () => {
  it("serializeGraphToCache converts DependencyGraph to graph cache files format", () => {
    const graph: DependencyGraph = new Map([
      [
        "/repo/src/a.ts",
        {
          deps: ["/repo/src/b.ts"],
          defs: ["A"],
        },
      ],
      [
        "/repo/src/b.ts",
        {
          deps: [],
          defs: ["B"],
        },
      ],
    ]);

    const files = serializeGraphToCache(graph);

    expect(files["/repo/src/a.ts"]).toEqual({
      deps: ["/repo/src/b.ts"],
      defs: ["A"],
    });
    expect(files["/repo/src/b.ts"]).toEqual({
      deps: [],
      defs: ["B"],
    });
  });

  it("isSourceFile accepts all supported parser-backed source extensions", () => {
    expect(isSourceFile("src/a.ts")).toBe(true);
    expect(isSourceFile("src/a.tsx")).toBe(true);
    expect(isSourceFile("src/a.js")).toBe(true);
    expect(isSourceFile("src/a.jsx")).toBe(true);
    expect(isSourceFile("src/a.mjs")).toBe(true);
    expect(isSourceFile("src/a.cjs")).toBe(true);
    expect(isSourceFile("src/a.py")).toBe(true);
    expect(isSourceFile("src/a.rs")).toBe(true);
    expect(isSourceFile("src/a.go")).toBe(true);
    expect(isSourceFile("src/A.java")).toBe(true);
    expect(isSourceFile("src/a.c")).toBe(true);
    expect(isSourceFile("src/a.h")).toBe(true);
    expect(isSourceFile("src/a.cpp")).toBe(true);
    expect(isSourceFile("src/a.cc")).toBe(true);
    expect(isSourceFile("src/a.cxx")).toBe(true);
    expect(isSourceFile("src/a.hpp")).toBe(true);
    expect(isSourceFile("src/a.hh")).toBe(true);
    expect(isSourceFile("src/a.hxx")).toBe(true);
    expect(isSourceFile("src/a.json")).toBe(false);
    expect(isSourceFile("README.md")).toBe(false);
  });

  it("resolveSourceFilePaths includes all supported source files", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "cache-ctrl-watch-"));
    const srcDir = join(repoRoot, "src");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "a.ts"), "export const a = 1;\n", "utf-8");
    await writeFile(join(srcDir, "b.tsx"), "export const b = <div />;\n", "utf-8");
    await writeFile(join(srcDir, "c.js"), "export const c = 1;\n", "utf-8");
    await writeFile(join(srcDir, "d.jsx"), "export const d = <div />;\n", "utf-8");
    await writeFile(join(srcDir, "e.py"), "from .dep import f\n", "utf-8");
    await writeFile(join(srcDir, "f.rs"), "mod dep;\n", "utf-8");
    await writeFile(join(srcDir, "g.go"), "package src\n", "utf-8");
    await writeFile(join(srcDir, "H.java"), "class H {}\n", "utf-8");
    await writeFile(join(srcDir, "i.c"), "#include \"dep.h\"\n", "utf-8");
    await writeFile(join(srcDir, "i.h"), "#pragma once\n", "utf-8");
    await writeFile(join(srcDir, "j.cpp"), "#include \"dep.hpp\"\n", "utf-8");
    await writeFile(join(srcDir, "k.cc"), "#include \"dep.hpp\"\n", "utf-8");
    await writeFile(join(srcDir, "l.cxx"), "#include \"dep.hpp\"\n", "utf-8");
    await writeFile(join(srcDir, "m.hpp"), "#pragma once\n", "utf-8");
    await writeFile(join(srcDir, "n.hh"), "#pragma once\n", "utf-8");
    await writeFile(join(srcDir, "o.hxx"), "#pragma once\n", "utf-8");

    const mockGetTrackedFiles = async (): Promise<string[]> => [
      "src/a.ts",
      "src/b.tsx",
      "src/c.js",
      "src/d.jsx",
      "src/e.py",
      "src/f.rs",
      "src/g.go",
      "src/H.java",
      "src/i.c",
      "src/i.h",
      "src/j.cpp",
      "src/k.cc",
      "src/l.cxx",
      "src/m.hpp",
      "src/n.hh",
      "src/o.hxx",
      "src/m.json",
      "README.md",
    ];

    const filePaths = await resolveSourceFilePaths(repoRoot, mockGetTrackedFiles);

    expect(new Set(filePaths)).toEqual(
      new Set([
        join(repoRoot, "src", "a.ts"),
        join(repoRoot, "src", "b.tsx"),
        join(repoRoot, "src", "c.js"),
        join(repoRoot, "src", "d.jsx"),
        join(repoRoot, "src", "e.py"),
        join(repoRoot, "src", "f.rs"),
        join(repoRoot, "src", "g.go"),
        join(repoRoot, "src", "H.java"),
        join(repoRoot, "src", "i.c"),
        join(repoRoot, "src", "i.h"),
        join(repoRoot, "src", "j.cpp"),
        join(repoRoot, "src", "k.cc"),
        join(repoRoot, "src", "l.cxx"),
        join(repoRoot, "src", "m.hpp"),
        join(repoRoot, "src", "n.hh"),
        join(repoRoot, "src", "o.hxx"),
      ]),
    );

    await rm(repoRoot, { recursive: true, force: true });
  });

  it("resolveSourceFilePaths excludes symlinked paths escaping repo root", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "cache-ctrl-watch-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "cache-ctrl-watch-outside-"));
    const srcDir = join(repoRoot, "src");
    await mkdir(srcDir, { recursive: true });

    const insideFile = join(srcDir, "inside.ts");
    const outsideFile = join(outsideRoot, "outside.ts");
    const symlinkPath = join(srcDir, "outside-link.ts");

    await writeFile(insideFile, "export const inside = true;\n", "utf-8");
    await writeFile(outsideFile, "export const outside = true;\n", "utf-8");
    await symlink(outsideFile, symlinkPath);

    const mockGetTrackedFiles = async (): Promise<string[]> => ["src/inside.ts", "src/outside-link.ts"];

    const filePaths = await resolveSourceFilePaths(repoRoot, mockGetTrackedFiles);
    expect(filePaths).toEqual([insideFile]);

    await rm(repoRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  });

  it("rebuildGraphCache logs and returns when graph cache write fails", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const dependencies = {
      resolveSourceFilePaths: vi.fn(async () => ["/repo/src/a.ts"]),
      buildGraph: vi.fn(async (): Promise<DependencyGraph> =>
        new Map([
          [
            "/repo/src/a.ts",
            {
              deps: [],
              defs: ["A"],
            },
          ],
        ]),
      ),
      resolveGraphCachePath: vi.fn(() => "/repo/.cache-ctrl/graph.json"),
      writeCache: vi.fn(async () => ({
        ok: false as const,
        error: "disk full",
        code: ErrorCode.FILE_WRITE_ERROR,
      })),
    };

    await expect(rebuildGraphCache("/repo", "/repo/src/a.ts", false, dependencies)).resolves.toEqual({
      ok: false,
      error: "disk full",
      code: ErrorCode.FILE_WRITE_ERROR,
    });

    expect(stderrSpy).toHaveBeenCalledWith("[watch] Failed to update graph cache: disk full\n");
    expect(dependencies.writeCache).toHaveBeenCalledOnce();

    stderrSpy.mockRestore();
  });

  it("rebuildGraphCache returns ok and writes serialized graph payload", async () => {
    const dependencies = {
      resolveSourceFilePaths: vi.fn(async () => ["/repo/src/a.ts"]),
      buildGraph: vi.fn(async (): Promise<DependencyGraph> =>
        new Map([
          [
            "/repo/src/a.ts",
            {
              deps: ["/repo/src/b.ts"],
              defs: ["A"],
            },
          ],
        ]),
      ),
      resolveGraphCachePath: vi.fn(() => "/repo/.cache-ctrl/graph.json"),
      writeCache: vi.fn(async () => ({
        ok: true as const,
        value: undefined,
      })),
    };

    const result = await rebuildGraphCache("/repo", "/repo/src/a.ts", false, dependencies);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(dependencies.writeCache).toHaveBeenCalledOnce();
    expect(dependencies.writeCache).toHaveBeenCalledWith(
      "/repo/.cache-ctrl/graph.json",
      {
        files: {
          "/repo/src/a.ts": {
            deps: ["/repo/src/b.ts"],
            defs: ["A"],
          },
        },
        computed_at: expect.any(String),
      },
      "replace",
    );
  });

  it("createRecursiveFileWatcher returns UNKNOWN when fs.watch throws", async () => {
    const invalidPath = join(tmpdir(), "cache-ctrl-watch-missing", String(Date.now()));

    const result = await createRecursiveFileWatcher(invalidPath, () => {}, () => {});

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe(ErrorCode.UNKNOWN);
  });

  it("createRecursiveFileWatcher observes nested files and new subdirectories", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "cache-ctrl-watch-live-"));
    const nestedDirectory = join(repoRoot, "src", "nested");
    const nestedFile = join(nestedDirectory, "a.ts");
    const createdDirectory = join(repoRoot, "src", "created");
    const createdFile = join(createdDirectory, "b.ts");

    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(nestedFile, "export const before = true;\n", "utf-8");

    const changedPaths: string[] = [];
    const waitForChangedPath = async (expectedPath: string): Promise<void> => {
      const startedAt = Date.now();

      while (!changedPaths.includes(expectedPath)) {
        if (Date.now() - startedAt > 5_000) {
          throw new Error(`Timed out waiting for watcher event: ${expectedPath}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };

    const watcherResult = await createRecursiveFileWatcher(
      repoRoot,
      (_event, changedPath) => {
        changedPaths.push(changedPath);
      },
      () => {
        throw new Error("watcher error should not fire");
      },
    );

    expect(watcherResult.ok).toBe(true);
    if (!watcherResult.ok) {
      await rm(repoRoot, { recursive: true, force: true });
      return;
    }

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await appendFile(nestedFile, "export const after = true;\n", "utf-8");
      await waitForChangedPath(nestedFile);

      await mkdir(createdDirectory, { recursive: true });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await writeFile(createdFile, "export const created = true;\n", "utf-8");
      await waitForChangedPath(createdFile);
    } finally {
      watcherResult.value.close?.();
      await rm(repoRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it("watchCommand returns initial rebuild error and does not start watcher", async () => {
    const rebuildError = {
      ok: false as const,
      error: "initial rebuild failed",
      code: ErrorCode.FILE_WRITE_ERROR,
    };

    const dependencies = {
      findRepoRoot: vi.fn(async () => "/repo"),
      rebuildGraphCache: vi.fn(async () => rebuildError),
      createWatcher: vi.fn(async () => ({
        ok: true as const,
        value: {},
      })),
      setDebounceTimer: setTimeout,
      clearDebounceTimer: clearTimeout,
      createKeepAlivePromise: vi.fn(async () => ({
        ok: false as const,
        error: "should not be called",
        code: ErrorCode.UNKNOWN,
      })),
    };

    const result = await watchCommand({ verbose: false }, dependencies);

    expect(result).toEqual(rebuildError);
    expect(dependencies.rebuildGraphCache).toHaveBeenCalledTimes(1);
    expect(dependencies.createWatcher).not.toHaveBeenCalled();
    expect(dependencies.createKeepAlivePromise).not.toHaveBeenCalled();
  });

  it("watchCommand returns watcher creation error after successful initial rebuild", async () => {
    const watcherCreationError = {
      ok: false as const,
      error: "watcher unavailable",
      code: ErrorCode.UNKNOWN,
    };

    const dependencies = {
      findRepoRoot: vi.fn(async () => "/repo"),
      rebuildGraphCache: vi.fn(async () => ({ ok: true as const, value: undefined })),
      createWatcher: vi.fn(async () => watcherCreationError),
      setDebounceTimer: setTimeout,
      clearDebounceTimer: clearTimeout,
      createKeepAlivePromise: vi.fn(async () => ({
        ok: false as const,
        error: "should not be called",
        code: ErrorCode.UNKNOWN,
      })),
    };

    const result = await watchCommand({ verbose: false }, dependencies);

    expect(result).toEqual(watcherCreationError);
    expect(dependencies.rebuildGraphCache).toHaveBeenCalledTimes(1);
    expect(dependencies.createKeepAlivePromise).not.toHaveBeenCalled();
  });

  it("watchCommand debounces source changes and rebuilds with changed path", async () => {
    vi.useFakeTimers();
    try {
      let watchCallback: ((event: "rename" | "change", changedPath: string, hasExplicitFilename: boolean) => void) | undefined;
      const createWatcher = vi.fn(async (_watchPath: string, callback) => {
        watchCallback = callback;
        return { ok: true as const, value: {} };
      });

      const dependencies = {
        findRepoRoot: vi.fn(async () => "/repo"),
        rebuildGraphCache: vi.fn(async () => ({ ok: true as const, value: undefined })),
        createWatcher,
        setDebounceTimer: setTimeout,
        clearDebounceTimer: clearTimeout,
        createKeepAlivePromise: vi.fn(async () => ({
          ok: false as const,
          error: "stop test keep-alive",
          code: ErrorCode.UNKNOWN,
        })),
      };

      const commandPromise = watchCommand({ verbose: false }, dependencies);

      await Promise.resolve();
      await Promise.resolve();

      expect(watchCallback).toBeTypeOf("function");
      watchCallback?.("change", "/repo/src/a.ts", true);
      watchCallback?.("change", "/repo/README.md", true);

      await vi.advanceTimersByTimeAsync(200);
      const result = await commandPromise;

      expect(result.ok).toBe(false);
      expect(dependencies.rebuildGraphCache).toHaveBeenCalledTimes(2);
      expect(dependencies.rebuildGraphCache).toHaveBeenNthCalledWith(1, "/repo", undefined, false);
      expect(dependencies.rebuildGraphCache).toHaveBeenNthCalledWith(2, "/repo", "/repo/src/a.ts", false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("watchCommand rebuilds on directory rename events", async () => {
    vi.useFakeTimers();
    try {
      let watchCallback: ((event: "rename" | "change", changedPath: string, hasExplicitFilename: boolean) => void) | undefined;
      const createWatcher = vi.fn(async (_watchPath: string, callback) => {
        watchCallback = callback;
        return { ok: true as const, value: {} };
      });

      const dependencies = {
        findRepoRoot: vi.fn(async () => "/repo"),
        rebuildGraphCache: vi.fn(async () => ({ ok: true as const, value: undefined })),
        createWatcher,
        setDebounceTimer: setTimeout,
        clearDebounceTimer: clearTimeout,
        createKeepAlivePromise: vi.fn(async () => ({
          ok: false as const,
          error: "stop test keep-alive",
          code: ErrorCode.UNKNOWN,
        })),
      };

      const commandPromise = watchCommand({ verbose: false }, dependencies);
      await Promise.resolve();
      await Promise.resolve();

      watchCallback?.("rename", "/repo/src/generated", false);

      await vi.advanceTimersByTimeAsync(200);
      const result = await commandPromise;

      expect(result.ok).toBe(false);
      expect(dependencies.rebuildGraphCache).toHaveBeenCalledTimes(2);
      expect(dependencies.rebuildGraphCache).toHaveBeenNthCalledWith(2, "/repo", "/repo/src/generated", false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("watchCommand rebuilds when a change event has no explicit filename", async () => {
    vi.useFakeTimers();
    try {
      let watchCallback: ((event: "rename" | "change", changedPath: string, hasExplicitFilename: boolean) => void) | undefined;
      const createWatcher = vi.fn(async (_watchPath: string, callback) => {
        watchCallback = callback;
        return { ok: true as const, value: {} };
      });

      const dependencies = {
        findRepoRoot: vi.fn(async () => "/repo"),
        rebuildGraphCache: vi.fn(async () => ({ ok: true as const, value: undefined })),
        createWatcher,
        setDebounceTimer: setTimeout,
        clearDebounceTimer: clearTimeout,
        createKeepAlivePromise: vi.fn(async () => ({
          ok: false as const,
          error: "stop test keep-alive",
          code: ErrorCode.UNKNOWN,
        })),
      };

      const commandPromise = watchCommand({ verbose: false }, dependencies);
      await Promise.resolve();
      await Promise.resolve();

      watchCallback?.("change", "/repo/src", false);

      await vi.advanceTimersByTimeAsync(200);
      const result = await commandPromise;

      expect(result.ok).toBe(false);
      expect(dependencies.rebuildGraphCache).toHaveBeenCalledTimes(2);
      expect(dependencies.rebuildGraphCache).toHaveBeenNthCalledWith(2, "/repo", "/repo/src", false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("watchCommand logs asynchronous watcher errors and keeps running", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    try {
      let watcherErrorHandler: ((error: { ok: false; error: string; code: string }) => void) | undefined;
      let resolveKeepAlive: ((result: Result<never>) => void) | undefined;
      const dependencies = {
        findRepoRoot: vi.fn(async () => "/repo"),
        rebuildGraphCache: vi.fn(async () => ({ ok: true as const, value: undefined })),
        createWatcher: vi.fn(async (_watchPath: string, _callback, onError) => {
          watcherErrorHandler = onError;
          return { ok: true as const, value: {} };
        }),
        setDebounceTimer: setTimeout,
        clearDebounceTimer: clearTimeout,
        createKeepAlivePromise: vi.fn(
          () =>
            new Promise<Result<never>>((resolve) => {
              resolveKeepAlive = resolve;
            }),
        ),
      };

      const commandPromise = watchCommand({ verbose: false }, dependencies);
      const startedAt = Date.now();
      while (resolveKeepAlive === undefined || watcherErrorHandler === undefined) {
        if (Date.now() - startedAt > 1_000) {
          throw new Error("watchCommand did not finish startup in time");
        }
        await Promise.resolve();
      }

      watcherErrorHandler?.({ ok: false, error: "watch backend failed", code: ErrorCode.UNKNOWN });
      resolveKeepAlive?.({ ok: false, error: "stop test keep-alive", code: ErrorCode.UNKNOWN });

      const result = await commandPromise;

      expect(result.ok).toBe(false);
      expect(stderrSpy).toHaveBeenCalledWith("[watch] Watcher error: watch backend failed\n");
    } finally {
      stderrSpy.mockRestore();
    }
  }, 10_000);
});

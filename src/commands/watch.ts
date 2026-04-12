import path from "node:path";
import { realpath } from "node:fs/promises";

import { buildGraph, type DependencyGraph } from "../analysis/graphBuilder.js";
import { findRepoRoot, writeCache } from "../cache/cacheManager.js";
import { resolveGraphCachePath } from "../cache/graphCache.js";
import { getGitTrackedFiles } from "../files/gitFiles.js";
import type { GraphCacheFile } from "../types/cache.js";
import type { WatchArgs } from "../types/commands.js";
import { ErrorCode, type Result } from "../types/result.js";
import { toUnknownResult } from "../utils/errors.js";

const WATCH_DEBOUNCE_MS = 200;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

type TrackedFilesProvider = (repoRoot: string) => Promise<string[]>;
type WatchEvent = "rename" | "change";
type BunWatchCallback = (event: WatchEvent, filename: string | null) => void;

interface WatcherHandle {
  close?: () => void;
  stop?: () => void;
}

type BunWatchFunction = (
  watchPath: string,
  options: { recursive: boolean },
  callback: BunWatchCallback,
) => WatcherHandle;

function resolveBunWatch(): Result<BunWatchFunction> {
  const watchFn = Reflect.get(Object(Bun), "watch");
  if (typeof watchFn !== "function") {
    return {
      ok: false,
      error: "Bun.watch is not available in this runtime",
      code: ErrorCode.UNKNOWN,
    };
  }
  return { ok: true, value: watchFn };
}

/**
 * Checks whether a file path is a supported source file for graph analysis.
 *
 * @param filePath - Absolute or relative file path.
 * @returns `true` when extension is one of `.ts`, `.tsx`, `.js`, `.jsx`.
 */
export function isSourceFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return SOURCE_EXTENSIONS.has(extension);
}

/**
 * Converts in-memory dependency graph nodes into graph cache file shape.
 *
 * @param graph - Dependency graph to serialize.
 * @returns `GraphCacheFile["files"]` payload suitable for `graph.json`.
 */
export function serializeGraphToCache(graph: DependencyGraph): GraphCacheFile["files"] {
  const files: GraphCacheFile["files"] = {};

  for (const [filePath, node] of graph.entries()) {
    files[filePath] = {
      rank: 0.0,
      deps: node.deps,
      defs: node.defs,
    };
  }

  return files;
}

/**
 * Resolves tracked source files to safe absolute paths for graph building.
 *
 * @param repoRoot - Repository root used for path resolution.
 * @param trackedFilesProvider - Optional provider for tracked paths (defaults to git).
 * @returns Absolute, de-duplicated source file paths constrained to `repoRoot`.
 */
export async function resolveSourceFilePaths(
  repoRoot: string,
  trackedFilesProvider: TrackedFilesProvider = getGitTrackedFiles,
): Promise<string[]> {
  const trackedFiles = await trackedFilesProvider(repoRoot);
  const normalizedRepoRoot = path.resolve(repoRoot);
  const repoPrefix = `${normalizedRepoRoot}${path.sep}`;
  const sourcePaths = new Set<string>();

  await Promise.all(
    trackedFiles.filter(isSourceFile).map(async (relPath) => {
      const absolutePath = path.join(normalizedRepoRoot, relPath);
      try {
        const resolvedPath = await realpath(absolutePath);
        if (resolvedPath === normalizedRepoRoot || resolvedPath.startsWith(repoPrefix)) {
          sourcePaths.add(resolvedPath);
        }
      } catch {
        // Ignore missing or unreadable paths from tracked files.
      }
    }),
  );

  return [...sourcePaths];
}

interface RebuildGraphCacheDependencies {
  resolveSourceFilePaths: typeof resolveSourceFilePaths;
  buildGraph: typeof buildGraph;
  resolveGraphCachePath: typeof resolveGraphCachePath;
  writeCache: typeof writeCache;
}

const defaultRebuildGraphCacheDependencies: RebuildGraphCacheDependencies = {
  resolveSourceFilePaths,
  buildGraph,
  resolveGraphCachePath,
  writeCache,
};

export async function rebuildGraphCache(
  repoRoot: string,
  changedPath: string | undefined,
  verbose: boolean,
  dependencies: RebuildGraphCacheDependencies = defaultRebuildGraphCacheDependencies,
): Promise<void> {
  try {
    const sourceFilePaths = await dependencies.resolveSourceFilePaths(repoRoot);
    const graph = await dependencies.buildGraph(sourceFilePaths, repoRoot);
    const graphCachePath = dependencies.resolveGraphCachePath(repoRoot);
    const graphPayload: GraphCacheFile = {
      files: serializeGraphToCache(graph),
      computed_at: new Date().toISOString(),
    };
    const writeResult = await dependencies.writeCache(graphCachePath, graphPayload, "replace");
    if (!writeResult.ok) {
      process.stderr.write(`[watch] Failed to update graph cache: ${writeResult.error}\n`);
      return;
    }
    if (verbose) {
      if (changedPath !== undefined) {
        process.stdout.write(`[watch] Graph updated: ${graph.size} files, changed: ${changedPath}\n`);
      } else {
        process.stdout.write(`[watch] Initial graph computed: ${graph.size} files\n`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[watch] Failed to rebuild graph: ${message}\n`);
  }
}

/**
 * Starts the long-running graph watch daemon.
 *
 * @param args - {@link WatchArgs} command arguments.
 * @returns Promise<Result<never>>; common failures include FILE_WRITE_ERROR via wrapped
 * UNKNOWN, runtime unavailability errors, and UNKNOWN.
 */
export async function watchCommand(args: WatchArgs): Promise<Result<never>> {
  try {
    const repoRoot = await findRepoRoot(process.cwd());

    const initialSourceFiles = await resolveSourceFilePaths(repoRoot);
    const initialGraph = await buildGraph(initialSourceFiles, repoRoot);
    const graphCachePath = resolveGraphCachePath(repoRoot);
    const initialPayload: GraphCacheFile = {
      files: serializeGraphToCache(initialGraph),
      computed_at: new Date().toISOString(),
    };
    const initialWriteResult = await writeCache(graphCachePath, initialPayload, "replace");
    if (!initialWriteResult.ok) {
      const errorMessage = `[watch] Failed to write initial graph cache: ${initialWriteResult.error}`;
      process.stderr.write(`${errorMessage}\n`);
      return {
        ok: false,
        error: errorMessage,
        code: ErrorCode.UNKNOWN,
      };
    }
    if (args.verbose) {
      process.stdout.write(`[watch] Initial graph computed: ${initialGraph.size} files\n`);
    }

    let pendingChangedPath: string | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let rebuildInProgress = false;
    let rebuildQueued = false;

    const triggerRebuild = async (): Promise<void> => {
      if (rebuildInProgress) {
        rebuildQueued = true;
        return;
      }

      rebuildInProgress = true;
      try {
        do {
          rebuildQueued = false;
          const changedPath = pendingChangedPath;
          pendingChangedPath = undefined;
          await rebuildGraphCache(repoRoot, changedPath, args.verbose === true);
        } while (rebuildQueued);
      } finally {
        rebuildInProgress = false;
      }
    };

    const scheduleRebuild = (changedPath: string): void => {
      pendingChangedPath = changedPath;

      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        debounceTimer = undefined;
        void triggerRebuild();
      }, WATCH_DEBOUNCE_MS);
    };

    const watchResult = resolveBunWatch();
    if (!watchResult.ok) {
      process.stderr.write(`[watch] ${watchResult.error}\n`);
      return watchResult;
    }

    const watcher = watchResult.value(repoRoot, { recursive: true }, (_event, filename) => {
      if (filename === null) {
        return;
      }

      const absolutePath = path.join(repoRoot, filename);
      if (!isSourceFile(absolutePath)) {
        return;
      }

      if (args.verbose) {
        process.stdout.write(`[watch] File changed: ${absolutePath}, recomputing...\n`);
      }

      scheduleRebuild(absolutePath);
    });

    const shutdown = (): void => {
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
      }
      if (args.verbose) {
        process.stdout.write("[watch] Shutting down\n");
      }
      if (typeof watcher.close === "function") {
        watcher.close();
      } else if (typeof watcher.stop === "function") {
        watcher.stop();
      }
      process.exit(0);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);

    return new Promise<never>(() => {
      // Keep command alive until signal-based shutdown.
    });
  } catch (err) {
    const unknownError = toUnknownResult(err);
    const message = unknownError.error;
    process.stderr.write(`[watch] Failed to start watcher: ${message}\n`);
    return unknownError;
  }
}

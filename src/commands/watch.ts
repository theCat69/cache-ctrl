import path from "node:path";
import { watch as watchFileSystem, type FSWatcher } from "node:fs";
import { realpath } from "node:fs/promises";

import { buildGraph, type DependencyGraph } from "../analysis/graphBuilder.js";
import { isSupportedSourceExtension } from "../analysis/supportedLanguages.js";
import { findRepoRoot, writeCache } from "../cache/cacheManager.js";
import { resolveGraphCachePath } from "../cache/localCache.js";
import { getGitTrackedFiles } from "../files/gitFiles.js";
import type { GraphCacheFile } from "../types/cache.js";
import type { WatchArgs } from "../types/commands.js";
import type { CacheError } from "../types/result.js";
import { type Result } from "../types/result.js";
import { toUnknownResult } from "../errors.js";

const WATCH_DEBOUNCE_MS = 200;
const WATCH_SYNC_DEBOUNCE_MS = 100;
const WATCH_SYNC_MAX_RETRY_MS = 5_000;
const IGNORED_WATCH_DIRECTORIES = new Set([
  ".ai",
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

type TrackedFilesProvider = (repoRoot: string) => Promise<string[]>;
type WatchEvent = "rename" | "change";
type FileWatchCallback = (
  event: WatchEvent,
  changedPath: string,
  hasExplicitFilename: boolean,
  isWithinTrackedScope: boolean,
) => void;
type WatchErrorHandler = (error: { ok: false } & CacheError) => void;
type WatchDirectoriesProvider = (repoRoot: string) => Promise<string[]>;
type WatchFileSystem = (
  watchPath: string,
  listener: (event: WatchEvent, filename: string | null) => void,
) => FSWatcher;
type WatchSetTimeout = (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
type WatchClearTimeout = (timer: ReturnType<typeof setTimeout>) => void;

interface WatcherHandle {
  close?: () => void;
  stop?: () => void;
}

type FileWatcherFactory = (
  watchPath: string,
  callback: FileWatchCallback,
  onError: WatchErrorHandler,
) => Promise<Result<WatcherHandle>>;

interface RecursiveWatcherDependencies {
  watchFileSystem: WatchFileSystem;
  setSyncTimer: WatchSetTimeout;
  clearSyncTimer: WatchClearTimeout;
}

const defaultRecursiveWatcherDependencies: RecursiveWatcherDependencies = {
  watchFileSystem,
  setSyncTimer: setTimeout,
  clearSyncTimer: clearTimeout,
};

export async function resolveWatchDirectoryPaths(
  repoRoot: string,
  trackedFilesProvider: TrackedFilesProvider = getGitTrackedFiles,
): Promise<string[]> {
  const normalizedRepoRoot = path.resolve(repoRoot);
  const repoPrefix = `${normalizedRepoRoot}${path.sep}`;
  const trackedFiles = await trackedFilesProvider(repoRoot);
  const candidateDirectories = new Set<string>([normalizedRepoRoot]);

  for (const relativePath of trackedFiles) {
    if (!isSourceFile(relativePath)) {
      continue;
    }

    const pathSegments = relativePath.split(/[\\/]+/);
    if (pathSegments.some((segment) => IGNORED_WATCH_DIRECTORIES.has(segment))) {
      continue;
    }

    let currentDirectory = path.dirname(path.join(normalizedRepoRoot, relativePath));
    while (currentDirectory === normalizedRepoRoot || currentDirectory.startsWith(repoPrefix)) {
      candidateDirectories.add(currentDirectory);
      if (currentDirectory === normalizedRepoRoot) {
        break;
      }
      currentDirectory = path.dirname(currentDirectory);
    }
  }

  const existingDirectories = await Promise.all(
    [...candidateDirectories].map(async (directoryPath) => {
      try {
        const resolvedDirectory = await realpath(directoryPath);
        if (resolvedDirectory === normalizedRepoRoot || resolvedDirectory.startsWith(repoPrefix)) {
          return resolvedDirectory;
        }
      } catch {
        return undefined;
      }

      return undefined;
    }),
  );

  return [...new Set(existingDirectories.filter((directoryPath) => directoryPath !== undefined))];
}

export async function createRecursiveFileWatcher(
  watchPath: string,
  callback: FileWatchCallback,
  onError: WatchErrorHandler,
  watchDirectoriesProvider: WatchDirectoriesProvider = resolveWatchDirectoryPaths,
  dependencies: RecursiveWatcherDependencies = defaultRecursiveWatcherDependencies,
): Promise<Result<WatcherHandle>> {
  try {
    const directoryWatchers = new Map<string, FSWatcher>();
    let isClosed = false;
    let syncPromise: Promise<void> | undefined;
    let syncQueued = false;
    let syncTimer: ReturnType<typeof setTimeout> | undefined;
    let syncRetryDelayMs = WATCH_SYNC_DEBOUNCE_MS;

    const closeAllWatchers = (): void => {
      if (isClosed) {
        return;
      }

      isClosed = true;
      for (const watcher of directoryWatchers.values()) {
        watcher.close();
      }
      directoryWatchers.clear();
      if (syncTimer !== undefined) {
        dependencies.clearSyncTimer(syncTimer);
        syncTimer = undefined;
      }
    };

    const syncDirectoryWatchers = (): Promise<void> => {
      if (syncPromise !== undefined) {
        syncQueued = true;
        return syncPromise;
      }

      syncPromise = (async () => {
        try {
          do {
            syncQueued = false;
            const nextDirectories = new Set(await watchDirectoriesProvider(watchPath));
            if (isClosed) {
              return;
            }

            for (const [directoryPath, watcher] of directoryWatchers.entries()) {
              if (nextDirectories.has(directoryPath)) {
                continue;
              }

              watcher.close();
              directoryWatchers.delete(directoryPath);
            }

            for (const directoryPath of nextDirectories) {
              if (directoryWatchers.has(directoryPath)) {
                continue;
              }

              const watcher = dependencies.watchFileSystem(directoryPath, (event: WatchEvent, filename) => {
                const changedPath = filename === null
                  ? directoryPath
                  : path.join(directoryPath, filename.toString());
                const isWithinTrackedScope = [...directoryWatchers.keys()].some(
                  (trackedDirectory) =>
                    trackedDirectory !== watchPath &&
                    (changedPath === trackedDirectory || changedPath.startsWith(`${trackedDirectory}${path.sep}`)),
                );
                callback(event, changedPath, filename !== null, isWithinTrackedScope);
                if (event === "rename") {
                  scheduleWatcherSync();
                }
              });

              watcher.on("error", (error: unknown) => {
                directoryWatchers.delete(directoryPath);
                watcher.close();
                onError(toUnknownResult(error));
                scheduleWatcherSync(syncRetryDelayMs);
                });

              directoryWatchers.set(directoryPath, watcher);
            }
          } while (syncQueued && !isClosed);
          syncRetryDelayMs = WATCH_SYNC_DEBOUNCE_MS;
        } finally {
          syncPromise = undefined;
        }
      })();

      return syncPromise;
    };

    const runWatcherSync = (): Promise<void> =>
      syncDirectoryWatchers().catch((error: unknown) => {
        onError(toUnknownResult(error));
        scheduleWatcherSync(syncRetryDelayMs);
        syncRetryDelayMs = Math.min(syncRetryDelayMs * 2, WATCH_SYNC_MAX_RETRY_MS);
      });

    const scheduleWatcherSync = (delayMs = WATCH_SYNC_DEBOUNCE_MS): void => {
      if (isClosed || syncTimer !== undefined) {
        return;
      }

      syncTimer = dependencies.setSyncTimer(() => {
        syncTimer = undefined;
        void runWatcherSync();
      }, delayMs);
    };

    await syncDirectoryWatchers();

    return {
      ok: true,
      value: {
        close: closeAllWatchers,
        stop: closeAllWatchers,
      },
    };
  } catch (err) {
    return toUnknownResult(err);
  }
}

/**
 * Checks whether a file path is a supported source file for graph analysis.
 *
 * @param filePath - Absolute or relative file path.
 * @returns `true` when extension is supported by parser-backed graph analysis.
 */
export function isSourceFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return isSupportedSourceExtension(extension);
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

const defaultRebuildGraphCacheDependencies = {
  resolveSourceFilePaths,
  buildGraph,
  resolveGraphCachePath,
  writeCache,
};

type RebuildGraphCacheDependencies = typeof defaultRebuildGraphCacheDependencies;

interface WatchCommandDependencies {
  findRepoRoot: typeof findRepoRoot;
  rebuildGraphCache: typeof rebuildGraphCache;
  createWatcher: FileWatcherFactory;
  setDebounceTimer: typeof setTimeout;
  clearDebounceTimer: typeof clearTimeout;
  createKeepAlivePromise: () => Promise<Result<never>>;
}

const defaultWatchCommandDependencies: WatchCommandDependencies = {
  findRepoRoot,
  rebuildGraphCache,
  createWatcher: createRecursiveFileWatcher,
  setDebounceTimer: setTimeout,
  clearDebounceTimer: clearTimeout,
  createKeepAlivePromise: () =>
    new Promise<Result<never>>(() => {
      // Keep command alive until signal-based shutdown.
    }),
};

export async function rebuildGraphCache(
  repoRoot: string,
  changedPath: string | undefined,
  verbose: boolean,
  dependencies: RebuildGraphCacheDependencies = defaultRebuildGraphCacheDependencies,
): Promise<Result<void>> {
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
      return writeResult;
    }
    if (verbose) {
      if (changedPath !== undefined) {
        process.stdout.write(`[watch] Graph updated: ${graph.size} files, changed: ${changedPath}\n`);
      } else {
        process.stdout.write(`[watch] Initial graph computed: ${graph.size} files\n`);
      }
    }
    return { ok: true, value: undefined };
  } catch (err) {
    const unknownError = toUnknownResult(err);
    process.stderr.write(`[watch] Failed to rebuild graph: ${unknownError.error}\n`);
    return unknownError;
  }
}

/**
 * Starts the long-running graph watch daemon.
 *
 * @param args - {@link WatchArgs} command arguments.
 * @returns Promise<Result<never>>; common failures include FILE_WRITE_ERROR via wrapped
 * UNKNOWN, runtime unavailability errors, and UNKNOWN.
 */
export async function watchCommand(
  args: WatchArgs,
  dependencies: WatchCommandDependencies = defaultWatchCommandDependencies,
): Promise<Result<never>> {
  try {
    const repoRoot = await dependencies.findRepoRoot(process.cwd());

    const initialRebuildResult = await dependencies.rebuildGraphCache(
      repoRoot,
      undefined,
      args.verbose === true,
    );
    if (!initialRebuildResult.ok) {
      return initialRebuildResult;
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
          const rebuildResult = await dependencies.rebuildGraphCache(
            repoRoot,
            changedPath,
            args.verbose === true,
          );
          if (!rebuildResult.ok) {
            // Error already logged in rebuildGraphCache; continue watching for future changes.
            continue;
          }
        } while (rebuildQueued);
      } finally {
        rebuildInProgress = false;
      }
    };

    const scheduleRebuild = (changedPath: string): void => {
      pendingChangedPath = changedPath;

      if (debounceTimer !== undefined) {
        dependencies.clearDebounceTimer(debounceTimer);
      }

      debounceTimer = dependencies.setDebounceTimer(() => {
        debounceTimer = undefined;
        void triggerRebuild();
      }, WATCH_DEBOUNCE_MS);
    };

    const watchResult = await dependencies.createWatcher(
      repoRoot,
      (event, changedPath, hasExplicitFilename, isWithinTrackedScope) => {
        const hasFileExtension = path.extname(changedPath).length > 0;
        if (event === "rename" && hasExplicitFilename && !hasFileExtension && !isWithinTrackedScope) {
          return;
        }
        if (event === "rename" && hasExplicitFilename && hasFileExtension && !isSourceFile(changedPath)) {
          return;
        }
        if (event !== "rename" && hasExplicitFilename && !isSourceFile(changedPath)) {
          return;
        }

        if (args.verbose === true) {
          process.stdout.write(`[watch] File changed: ${changedPath}, recomputing...\n`);
        }

        scheduleRebuild(changedPath);
      },
      (watchError) => {
        process.stderr.write(`[watch] Watcher error: ${watchError.error}\n`);
      },
    );
    if (!watchResult.ok) {
      process.stderr.write(`[watch] ${watchResult.error}\n`);
      return watchResult;
    }

    const watcher = watchResult.value;

    const shutdown = (): void => {
      if (debounceTimer !== undefined) {
        dependencies.clearDebounceTimer(debounceTimer);
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

    return dependencies.createKeepAlivePromise();
  } catch (err) {
    const unknownError = toUnknownResult(err);
    const message = unknownError.error;
    process.stderr.write(`[watch] Failed to start watcher: ${message}\n`);
    return unknownError;
  }
}

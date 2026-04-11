# Watch daemon command pattern — long-running Bun watcher with debounce and graceful shutdown

## Pattern: `watchCommand` that never resolves and safely handles rapid file changes

Use a debounced rebuild scheduler to coalesce bursty FS events, then keep the process alive
with a never-resolving Promise until SIGINT/SIGTERM shuts down the watcher.

```typescript
// src/commands/watch.ts

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
  }, 200);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

return new Promise<never>(() => {
  // Keep daemon alive until signal-based shutdown.
});
```

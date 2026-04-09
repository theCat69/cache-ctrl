# Command handler pattern — async command function returning Result<T> with typed Args

## Pattern: one file per command, one exported async function, delegate all I/O to services

Each CLI subcommand lives in `src/commands/<verb>.ts` and exports a single `<verb>Command(args)` function.
Commands are thin orchestrators — they validate, delegate to services, and return typed Results.

```typescript
// src/commands/list.ts — a representative command handler

import { join } from "node:path";
import { findRepoRoot, listCacheFiles, readCache } from "../cache/cacheManager.js";
import { getAgeHuman, isExternalStale, getFileStem } from "../cache/externalCache.js";
import { ExternalCacheFileSchema, LocalCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import type { ListArgs, ListEntry, ListResult } from "../types/commands.js";  // import type for type-only imports

// The command function signature: typed Args in, Promise<Result<T>> out
export async function listCommand(args: ListArgs): Promise<Result<ListResult["value"]>> {
  try {
    // 1. Anchor all paths to the git repo root
    const repoRoot = await findRepoRoot(process.cwd());
    const agent = args.agent ?? "all";
    const entries: ListEntry[] = [];

    // 2. Delegate all I/O to service modules — no direct fs calls here
    if (agent === "external" || agent === "all") {
      const filesResult = await listCacheFiles("external", repoRoot);
      if (!filesResult.ok) return filesResult;  // propagate errors as-is

      for (const filePath of filesResult.value) {
        const readResult = await readCache(filePath);
        if (!readResult.ok) continue;   // skip unreadable files, don't abort

        // Validate schema before using data
        const parseResult = ExternalCacheFileSchema.safeParse(readResult.value);
        if (!parseResult.success) {
          process.stderr.write(`[cache-ctrl] Warning: skipping malformed external cache file: ${filePath}\n`);
          continue;
        }
        const data = parseResult.data;

        // 3. Build typed result objects
        entries.push({
          file: filePath,
          agent: "external",
          subject: data.subject ?? getFileStem(filePath),
          fetched_at: data.fetched_at ?? "",
          age_human: getAgeHuman(data.fetched_at ?? ""),
          is_stale: isExternalStale(data),
        });
      }
    }

    // 4. Return success — always wrap in { ok: true, value: ... }
    return { ok: true, value: entries };

  } catch (err) {
    // 5. Top-level catch converts unexpected throws to a typed UNKNOWN error
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, code: ErrorCode.UNKNOWN };
  }
}
```

## Routing in `src/index.ts` — how commands are wired to the CLI

```typescript
case "list": {
  const agentArg = typeof flags.agent === "string" ? flags.agent : undefined;
  // Validate CLI arg before passing to command
  const validAgents = ["external", "local", "all", undefined];
  if (!validAgents.includes(agentArg)) {
    usageError(`Invalid --agent value: "${agentArg}". Must be external, local, or all`);
  }
  // Call the command handler
  const result = await listCommand({ agent: agentArg as "external" | "local" | "all" | undefined });
  if (result.ok) {
    printResult(result, pretty);       // JSON to stdout
  } else {
    printError(result, pretty);        // JSON to stderr
    process.exit(1);                   // non-zero exit on error
  }
  break;
}
```

## Key rules

- Every command accepts a typed `Args` interface (defined in `src/types/commands.ts`)
- Return type is always `Promise<Result<T>>` — never throw across the command boundary
- Always call `findRepoRoot(process.cwd())` to anchor file paths
- Delegate all filesystem and HTTP work to service modules
- Wrap the entire body in `try/catch` — convert unexpected throws to `ErrorCode.UNKNOWN`
- CLI routing in `index.ts` validates agent/subject args before calling the command

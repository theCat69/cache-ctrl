# cache-ctrl

A CLI tool and native opencode plugin that manages the two AI agent caches (`.ai/external-context-gatherer_cache/` and `.ai/local-context-gatherer_cache/`) with a uniform interface.

It handles advisory locking for safe concurrent writes, keyword search across all entries, HTTP freshness checking for external URLs, and file-change detection for local scans.

---

## Quick Start

### npm (recommended)

```sh
npm install -g @thecat69/cache-ctrl
cache-ctrl install
```

`cache-ctrl install` configures the OpenCode integration in one step:
- Writes an OpenCode tool wrapper at `~/.config/opencode/tools/cache_ctrl.ts` (Linux/macOS) or `%APPDATA%\opencode\tools\cache_ctrl.ts` (Windows).
- Copies 3 skill SKILL.md files to `~/.config/opencode/skills/`.

**Prerequisites**: `bun` ≥ 1.0.0 must be in `PATH` (Bun executes the TypeScript files natively — no build step).

### Local development (from source)

Run from inside the `cache-ctrl/` directory:

```zsh
zsh install.sh
```

This creates two symlinks:
- `~/.local/bin/cache-ctrl` → `src/index.ts` — global CLI command (executed directly by Bun)
- `.opencode/tools/cache-ctrl.ts` → `cache_ctrl.ts` — auto-discovered by OpenCode as a native plugin

`install.sh` is for local development only. For end-user installation, use `npm install -g @thecat69/cache-ctrl`.

---

## Architecture

```
CLI (cache-ctrl)          opencode Plugin
src/index.ts              cache_ctrl.ts
     │                         │
     └──────────┬──────────────┘
               │
        Command Layer
   src/commands/{list, inspect, flush,
    invalidate, touch, prune,
    checkFreshness, checkFiles, search,
    write, graph, map, watch}.ts
                 │
           Core Services
   cacheManager  ← read/write + advisory lock
   externalCache ← external staleness logic
   localCache    ← local scan path logic
   graphCache    ← graph.json read/write path
   freshnessChecker ← HTTP HEAD requests
   changeDetector   ← mtime/hash comparison
   keywordSearch    ← scoring engine
   analysis/symbolExtractor ← import/export AST pass
   analysis/graphBuilder    ← dependency graph construction
   analysis/pageRank        ← Personalized PageRank ranking
                 │
       Cache Directories (on disk)
   .ai/external-context-gatherer_cache/
     ├── <subject>.json
     └── <subject>.json.lock  (advisory)
   .ai/local-context-gatherer_cache/
     ├── context.json
     ├── context.json.lock    (advisory)
     └── graph.json           (dependency graph; written by watch daemon)
```

**Key design decisions:**
- All commands funnel through `cacheManager` for reads/writes — no direct filesystem access from command handlers.
- The CLI and plugin share the same command functions — no duplicated business logic.
- All operations return `Result<T, CacheError>` — nothing throws into the caller.
- `writeCache` defaults to merging updates onto the existing object (preserving unknown agent fields). Local writes use per-path merge — submitted `tracked_files` entries replace existing entries for those paths; entries for other paths are preserved; entries for files no longer present on disk are evicted automatically.
- `write.ts` and `inspect.ts` are thin routers; all business logic lives in `writeLocal.ts`, `writeExternal.ts`, `inspectLocal.ts`, `inspectExternal.ts`.

---

## CLI Reference

**Output format**: JSON (single line) by default. Add `--pretty` to any command for indented output.  
**Errors**: Written to stderr as `{ "ok": false, "error": "...", "code": "..." }`. Exit code `1` on error, `2` on bad arguments.  
**Help**: Run `cache-ctrl --help` or `cache-ctrl help` for the full command reference. Run `cache-ctrl help <command>` for per-command usage, arguments, and options. Help output is plain text written to stdout; exit code `0` on success, `1` for unknown command.

---

### `install`

```
cache-ctrl install [--config-dir <path>]
```

Configures OpenCode integration after `npm install -g @thecat69/cache-ctrl`. Does two things:

1. **Generates an OpenCode tool wrapper** at `<opencode-config>/tools/cache_ctrl.ts` — a one-line re-export that points back to the installed package so Bun resolves all relative imports correctly.
2. **Copies 3 skill files** (`cache-ctrl-caller`, `cache-ctrl-local`, `cache-ctrl-external`) to `<opencode-config>/skills/<name>/SKILL.md`.

Both operations are idempotent — re-running `cache-ctrl install` after `npm update -g @thecat69/cache-ctrl` regenerates the wrapper with the new package path.

**OpenCode config directory resolution** (in priority order):
1. `--config-dir <path>` flag (explicit override)
2. `$XDG_CONFIG_HOME/opencode` (Linux/macOS, if `XDG_CONFIG_HOME` is set)
3. `~/.config/opencode` (Linux/macOS default)
4. `%APPDATA%\opencode` (Windows)

**Options:**

| Flag | Description |
|---|---|
| `--config-dir <path>` | Override the detected OpenCode config directory |

```jsonc
// cache-ctrl install --pretty
{
  "ok": true,
  "value": {
    "configDir": "/home/user/.config/opencode",
    "toolPath": "/home/user/.config/opencode/tools/cache_ctrl.ts",
    "skillPaths": [
      "/home/user/.config/opencode/skills/cache-ctrl-caller/SKILL.md",
      "/home/user/.config/opencode/skills/cache-ctrl-local/SKILL.md",
      "/home/user/.config/opencode/skills/cache-ctrl-external/SKILL.md"
    ]
  }
}
```

**Error codes**: `FILE_WRITE_ERROR` if the tool wrapper or a skill file cannot be written.

---

### `help`

```
cache-ctrl help [<command>]
cache-ctrl --help
```

Prints human-readable usage information and exits. No JSON output.

- `cache-ctrl --help` — print full command reference (all commands with descriptions)
- `cache-ctrl help` — same as `--help`
- `cache-ctrl help <command>` — print per-command usage, arguments, and options
- `cache-ctrl help help` — same as `cache-ctrl help` (full reference)

Exit code: `0` on success, `1` if `<command>` is not recognized.

---

### `list`

```
cache-ctrl list [--agent external|local|all] [--pretty]
```

Lists all cache entries. Shows age, human-readable age string, and staleness flag.

- External entries are stale if `fetched_at` is empty or older than 24 hours.
- Local entries show `is_stale: true` only when `cache_ctrl_check_files` detects actual changes (changed files, new non-ignored files, or deleted files). A freshly-written cache with no subsequent file changes shows `is_stale: false`.

**Default**: `--agent all`

```jsonc
// cache-ctrl list --pretty
{
  "ok": true,
  "value": [
    {
      "file": "/path/to/.ai/external-context-gatherer_cache/opencode-skills.json",
      "agent": "external",
      "subject": "opencode-skills",
      "description": "opencode skill file index",
      "fetched_at": "2026-04-04T10:00:00Z",
      "age_human": "2 hours ago",
      "is_stale": false
    }
  ]
}
```

---

### `inspect`

```
cache-ctrl inspect <agent> <subject-keyword> [--filter <kw>[,<kw>...]] [--folder <path>] [--search-facts <kw>[,<kw>...]] [--pretty]
```

Prints the full JSON content of the best-matching cache entry. Uses the same keyword scoring as `search`. Returns `AMBIGUOUS_MATCH` if two results score identically.

Three complementary filters are available for `agent: "local"` — they are AND-ed when combined:

**`--filter <kw>[,<kw>...]`** (local agent only): restricts `facts` to entries whose **file path** contains at least one keyword (case-insensitive substring). Ignored for the external agent.

**`--folder <path>`** (local agent only): restricts `facts` to entries whose **file path** equals the given folder prefix or starts with `<folder>/` (recursive subtree match). Returns `INVALID_ARGS` if used with the external agent.

**`--search-facts <kw>[,<kw>...]`** (local agent only): restricts `facts` to entries where **at least one fact string** contains any keyword (case-insensitive substring). Silently ignored for the external agent.

`global_facts` and all other metadata fields are always included regardless of which filters are set.

**`tracked_files` is never returned** for `agent: "local"` — it is internal operational metadata consumed by `check-files` and is always stripped from inspect responses.

```
cache-ctrl inspect external opencode-skills --pretty
cache-ctrl inspect local context --pretty
cache-ctrl inspect local context --filter lsp,nvim --pretty
cache-ctrl inspect local context --folder src/commands --pretty
cache-ctrl inspect local context --search-facts "Result<" --pretty
cache-ctrl inspect local context --folder src --filter commands --search-facts async --pretty
```

---

### `flush`

```
cache-ctrl flush <agent|all> --confirm [--pretty]
```

Deletes cache files. The `--confirm` flag is **required** as a safeguard.

- `external` → deletes all `*.json` files in the external cache directory (not `.lock` files)
- `local` → deletes `context.json`
- `all` → both

```
cache-ctrl flush external --confirm
cache-ctrl flush all --confirm --pretty
```

---

### `invalidate`

```
cache-ctrl invalidate <agent> [subject-keyword] [--pretty]
```

Zeros out the timestamp (`fetched_at` for external, `timestamp` for local), marking the entry as stale without deleting its content. Agents will treat it as a cache miss on next run.

- With a keyword: invalidates the best-matching file.
- Without a keyword on `external`: invalidates **all** external entries.
- Without a keyword on `local`: invalidates `context.json`.

> If the local cache file does not exist, returns `FILE_NOT_FOUND` — the command is a no-op in that case.

```
cache-ctrl invalidate external opencode-skills
cache-ctrl invalidate external          # all external entries
cache-ctrl invalidate local
```

---

### `touch`

```
cache-ctrl touch <agent> [subject-keyword] [--pretty]
```

Resets the timestamp to the current UTC time — the inverse of `invalidate`. Marks the entry as fresh.

- Without a keyword on `external`: touches **all** external entries.

```
cache-ctrl touch external opencode-skills
cache-ctrl touch local
```

---

### `prune`

```
cache-ctrl prune [--agent external|local|all] [--max-age <duration>] [--delete] [--pretty]
```

Finds entries older than `--max-age` and invalidates them (default) or deletes them (`--delete`).

**Duration format**: `<number><unit>` — `h` for hours, `d` for days. Examples: `24h`, `7d`, `1d`.

**Defaults**: `--agent all`, `--max-age 24h` for external. Local cache **always** matches (no TTL).

> If the local cache does not exist and `--delete` is not set, the local entry is skipped silently (not added to `matched`).

> ⚠️ `prune --agent all --delete` will **always** delete the local cache. Use `--agent external` to avoid this.

```
cache-ctrl prune --agent external --max-age 7d
cache-ctrl prune --agent external --max-age 1d --delete
```

---

### `check-freshness`

```
cache-ctrl check-freshness <subject-keyword> [--url <url>] [--pretty]
```

Sends HTTP HEAD requests to each URL in the matched external entry's `sources[]`. Uses conditional headers (`If-None-Match`, `If-Modified-Since`) from stored `header_metadata`. Updates `header_metadata` in-place after checking.

- HTTP 304 → `fresh`
- HTTP 200 → `stale` (resource changed)
- Network / 4xx / 5xx → `error` (does not update metadata for that URL)

With `--url`: checks only that specific URL (must exist in `sources[]`).

```jsonc
// cache-ctrl check-freshness opencode-skills --pretty
{
  "ok": true,
  "value": {
    "subject": "opencode-skills",
    "sources": [
      { "url": "https://example.com/docs", "status": "fresh", "http_status": 304 }
    ],
    "overall": "fresh"
  }
}
```

---

### `check-files`

```
cache-ctrl check-files [--pretty]
```

Reads `tracked_files[]` from the local cache and compares each file's current `mtime` (and `hash` if stored) against the saved values.

**Comparison logic:**
1. Read current `mtime` via `lstat()` (reflects the symlink node itself, not the target).
2. If stored `hash` is present and `mtime` changed → recompute SHA-256. Hash match → `unchanged` (touch-only). Hash differs → `changed`.
3. No stored `hash` → mtime change alone marks the file as `changed`.
4. File missing on disk → `missing`.

If `tracked_files` is absent or empty → returns `{ status: "unchanged", ... }` (not an error).

```jsonc
// cache-ctrl check-files --pretty
{
  "ok": true,
  "value": {
    "status": "unchanged",
    "changed_files": [],
    "unchanged_files": ["lua/plugins/ui/bufferline.lua"],
    "missing_files": []
  }
}
```

---

### `search`

```
cache-ctrl search <keyword> [<keyword>...] [--pretty]
```

Searches all cache files across both namespaces. Case-insensitive. Returns results ranked by score (descending).

**Scoring matrix** (per keyword, additive across multiple keywords):

| Match type | Score |
|---|---|
| Exact match on file stem | 100 |
| Substring match on file stem | 80 |
| Exact word match on `subject`/`topic` | 70 |
| Substring match on `subject`/`topic` | 50 |
| Keyword match on `description` | 30 |

```
cache-ctrl search opencode skills
cache-ctrl search neovim --pretty
```

---

### `write`

```
cache-ctrl write external <subject> --data '<json>' [--pretty]
cache-ctrl write local --data '<json>' [--pretty]
```

Writes a validated cache entry to disk. The `--data` argument must be a valid JSON string matching the ExternalCacheFile or LocalCacheFile schema. Schema validation runs first — all required fields must be present in `--data` or the write is rejected with `VALIDATION_ERROR`.

- `external`: `subject` is required as a positional argument. After validation, unknown fields from the existing file on disk are preserved (merge write).
- `local`: no subject argument; `timestamp` is **auto-set** to the current UTC time server-side — any value supplied in `--data` is silently overridden. `mtime` for each entry in `tracked_files[]` is **auto-populated** by the write command via filesystem `lstat()` — agents do not need to supply it. Local writes use per-path merge: submitted `tracked_files` entries replace existing entries for the same path; entries for other paths are preserved; entries for files deleted from disk are evicted automatically. On cold start (no existing cache), submit all relevant files for a full write; on subsequent writes, submit only new or changed files.
- `local`: facts paths are validated against submitted `tracked_files` — submitting a facts key outside that set returns `VALIDATION_ERROR`.

> `VALIDATION_ERROR` messages include the offending field path (e.g., `facts.src/foo.ts.2: write concise observations, not file content (max 800 chars per fact)`), making it straightforward to locate the violating value.

> The `subject` parameter (external agent) must match `/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/` and be at most 128 characters. Returns `INVALID_ARGS` if it fails validation.

**Always use this command (or `cache_ctrl_write`) instead of writing cache files directly.** Direct writes skip schema validation and risk corrupting the cache.

```json
// cache-ctrl write external mysubject --data '{"subject":"mysubject","description":"...","fetched_at":"2026-04-05T10:00:00Z","sources":[],"header_metadata":{}}' --pretty
{ "ok": true, "value": { "file": "/path/to/.ai/external-context-gatherer_cache/mysubject.json" } }
```

---

### `graph`

```
cache-ctrl graph [--max-tokens <number>] [--seed <path>[,<path>...]] [--pretty]
```

Returns a PageRank-ranked dependency graph within a token budget. Reads from `graph.json` computed by the `watch` daemon. Files are ranked by their centrality in the import graph; use `--seed` to personalize the ranking toward specific files (e.g. recently changed files).

**Options:**

| Flag | Description |
|---|---|
| `--max-tokens <number>` | Token budget for `ranked_files` output (default: 1024, clamped 64–128000) |
| `--seed <path>[,<path>...]` | Personalize PageRank toward these file paths (repeat `--seed` for multiple values) |

Returns `FILE_NOT_FOUND` if `graph.json` does not exist — run `cache-ctrl watch` to generate it.

```jsonc
// cache-ctrl graph --max-tokens 512 --pretty
{
  "ok": true,
  "value": {
    "ranked_files": [
      {
        "path": "src/cache/cacheManager.ts",
        "rank": 0.142,
        "deps": ["src/utils/validate.ts"],
        "defs": ["readCache", "writeCache", "findRepoRoot"],
        "ref_count": 12
      }
    ],
    "total_files": 36,
    "computed_at": "2026-04-11T10:00:00Z",
    "token_estimate": 487
  }
}
```

---

### `map`

```
cache-ctrl map [--depth overview|modules|full] [--folder <path-prefix>] [--pretty]
```

Returns a semantic map of the local `context.json` using the structured `FileFacts` metadata. Files are sorted by `importance` (ascending) then path. Use `--folder` to scope the output to a subtree.

**Options:**

| Flag | Description |
|---|---|
| `--depth overview\|modules\|full` | Output depth (default: `overview`) |
| `--folder <path-prefix>` | Restrict output to files whose path equals or starts with this prefix |

**Depth values:**
- `overview` — includes `summary`, `role`, `importance` per file (no individual facts)
- `modules` — same as `overview` plus the `modules` grouping from `context.json`
- `full` — includes all per-file `facts[]` strings

Returns `FILE_NOT_FOUND` if `context.json` does not exist.

```jsonc
// cache-ctrl map --depth overview --folder src/commands --pretty
{
  "ok": true,
  "value": {
    "depth": "overview",
    "global_facts": ["TypeScript CLI, Bun runtime"],
    "files": [
      {
        "path": "src/commands/graph.ts",
        "summary": "Reads graph.json and returns PageRank-ranked file list",
        "role": "implementation",
        "importance": 2
      }
    ],
    "total_files": 1,
    "folder_filter": "src/commands"
  }
}
```

---

### `watch`

```
cache-ctrl watch [--verbose]
```

Long-running daemon that watches the repo for source file changes (`.ts`, `.tsx`, `.js`, `.jsx`) and incrementally rebuilds `graph.json`. On startup it performs an initial full graph build. Subsequent file changes trigger a debounced rebuild (200 ms). Rebuilds are serialized — concurrent changes are queued.

Writes to `.ai/local-context-gatherer_cache/graph.json`. The graph is then available to `cache-ctrl graph` and `cache_ctrl_graph`.

**Options:**

| Flag | Description |
|---|---|
| `--verbose` | Log watcher lifecycle events and rebuild completion to stdout |

The process runs until `SIGINT` or `SIGTERM`, which trigger a clean shutdown. Exit code `1` on startup failure (e.g., `Bun.watch` unavailable or graph write error).

```sh
# Start the daemon in the background
cache-ctrl watch &

# Or run it in a dedicated terminal with verbose output
cache-ctrl watch --verbose
```

---

## opencode Plugin Tools

The plugin (`cache_ctrl.ts`) is auto-discovered via `~/.config/opencode/tools/cache_ctrl.ts` and registers 9 tools that call the same command functions as the CLI:

| Tool | Description |
|---|---|
| `cache_ctrl_search` | Search all cache entries by keyword |
| `cache_ctrl_list` | List entries with age and staleness flags |
| `cache_ctrl_inspect` | Return full content of a specific entry |
| `cache_ctrl_invalidate` | Zero out a cache entry's timestamp |
| `cache_ctrl_check_freshness` | HTTP HEAD check for external source URLs |
| `cache_ctrl_check_files` | Compare tracked files against stored mtime/hash |
| `cache_ctrl_write` | Write a validated cache entry; validates against ExternalCacheFile or LocalCacheFile schema |
| `cache_ctrl_graph` | Return a PageRank-ranked dependency graph within a token budget (reads `graph.json`) |
| `cache_ctrl_map` | Return a semantic map of `context.json` with per-file FileFacts metadata |

No bash permission is required for agents that use the plugin tools directly.

All 9 plugin tool responses include a `server_time` field at the outer JSON level:

```json
{ "ok": true, "value": { ... }, "server_time": "2026-04-05T12:34:56.789Z" }
```

Use `server_time` to assess how stale stored timestamps are without requiring bash or system access.

---

## Agent Integration

### `external-context-gatherer`

```zsh
# Before fetching — check if cache is still fresh
cache-ctrl list --agent external --pretty
# If is_stale: false → skip fetch

# For a precise HTTP freshness check on a borderline entry
cache-ctrl check-freshness <subject>
# If overall: "fresh" → skip re-fetch

# After writing new cache content — mark entry fresh
cache-ctrl touch external <subject>

# Force a re-fetch
cache-ctrl invalidate external <subject>
```

### `local-context-gatherer`

```zsh
# Before deciding whether to re-scan
cache-ctrl check-files
# If status: "changed" → invalidate and re-scan
cache-ctrl invalidate local
# If status: "unchanged" → use cached context
```

**Requirement**: The agent MUST populate `tracked_files[]` (with `path` and optionally `hash`) when writing its cache file. `mtime` per entry is auto-populated server-side via filesystem `lstat()` — agents do not need to supply it. `check-files` returns `unchanged` silently if `tracked_files` is absent.

---

## Cache File Schemas

### External: `.ai/external-context-gatherer_cache/<subject>.json`

```jsonc
{
  "subject": "opencode-skills",          // Must match the file stem
  "description": "opencode skill index", // One-liner for keyword search
  "fetched_at": "2026-04-04T12:00:00Z", // "" when invalidated
  "sources": [
    { "type": "github_api", "url": "https://..." }
  ],
  "header_metadata": {
    "https://...": {
      "etag": "\"abc123\"",
      "last_modified": "Fri, 04 Apr 2026 10:00:00 GMT",
      "checked_at": "2026-04-04T12:00:00Z",
      "status": "fresh"
    }
  }
  // Any additional agent fields are preserved unchanged
}
```

### Local: `.ai/local-context-gatherer_cache/context.json`

> `timestamp` is **auto-set** by the write command to the current UTC time. Do not include it in agent-supplied content — any value provided is silently overridden. `mtime` values in `tracked_files[]` are **auto-populated** by the write command via filesystem `lstat()` — agents only need to supply `path` (and optionally `hash`). Local writes use per-path merge: submitted `tracked_files` entries replace existing entries for the same path; entries for other paths are preserved; entries for files deleted from disk are evicted automatically. On cold start (no existing cache), submit all relevant files; on subsequent writes, submit only new or changed files.

```jsonc
{
  "timestamp": "2026-04-04T12:00:00Z",   // auto-set on write; "" when invalidated
  "topic": "cache-ctrl source",
  "description": "Scan of cache-ctrl TypeScript source",
  "cache_miss_reason": "files changed",  // optional: why the previous cache was discarded
  "tracked_files": [
    { "path": "src/commands/graph.ts", "mtime": 1743768000000, "hash": "sha256hex..." }
    // mtime is auto-populated by the write command; agents only need to supply path (and optionally hash)
  ],
  "global_facts": [                       // optional: repo-level facts; last-write-wins; max 20 entries, each ≤ 300 chars
    "TypeScript CLI tool executed by Bun",
    "All errors use Result<T,E> — no thrown exceptions across command boundaries"
  ],
  "facts": {                              // optional: per-file structured FileFacts; per-path merge
    "src/commands/graph.ts": {
      "summary": "Reads graph.json and returns PageRank-ranked file list within a token budget",
      "role": "implementation",           // one of: entry-point | interface | implementation | test | config
      "importance": 2,                    // 1 = critical, 2 = important, 3 = peripheral
      "facts": [                          // max 10 entries, each ≤ 300 chars
        "Uses computePageRank with optional seed files for personalized ranking",
        "Token budget clamped to 64–128000; defaults to 1024"
      ]
    }
    // FileFacts entries for files deleted from disk are evicted automatically on the next write
  },
  "modules": {                            // optional: logical groupings of file paths
    "commands": ["src/commands/graph.ts", "src/commands/map.ts"]
  }
  // Any additional agent fields are preserved unchanged
}
```

### Graph: `.ai/local-context-gatherer_cache/graph.json`

Written and maintained by the `watch` daemon. Read by `cache-ctrl graph` and `cache_ctrl_graph`. Agents do not write this file directly.

```jsonc
{
  "computed_at": "2026-04-11T10:00:00Z",
  "files": {
    "src/cache/cacheManager.ts": {
      "rank": 0.0,          // stored as 0.0; PageRank is recomputed on every graph command call
      "deps": ["src/utils/validate.ts", "src/types/result.ts"],
      "defs": ["readCache", "writeCache", "findRepoRoot"]
    }
  }
}
```

---

## Error Codes

| Code | Meaning |
|---|---|
| `FILE_NOT_FOUND` | Cache file does not exist |
| `FILE_READ_ERROR` | Cannot read file |
| `FILE_WRITE_ERROR` | Cannot write file |
| `PARSE_ERROR` | File is not valid JSON |
| `LOCK_TIMEOUT` | Could not acquire lock within 5 seconds |
| `LOCK_ERROR` | Unexpected lock file error |
| `INVALID_ARGS` | Missing or invalid CLI arguments |
| `CONFIRMATION_REQUIRED` | `flush` called without `--confirm` |
| `VALIDATION_ERROR` | Schema validation failed (e.g., missing required field or type mismatch in `write`) |
| `NO_MATCH` | No cache file matched the keyword |
| `AMBIGUOUS_MATCH` | Multiple files with identical top score |
| `HTTP_REQUEST_FAILED` | Network error during HEAD request |
| `URL_NOT_FOUND` | `--url` value not found in `sources[]` |
| `UNKNOWN` | Unexpected internal error |

---

## Development

```zsh
# Run unit tests
bun run test

# Watch mode
bun run test:watch

# Run E2E tests (requires Docker)
bun run test:e2e

# Re-run installer (idempotent)
zsh install.sh
```

Unit tests live in `tests/` and use Vitest. Filesystem operations use real temp directories; HTTP calls are mocked with `vi.mock`.

E2E tests live in `e2e/tests/` and run inside Docker via `docker compose -f e2e/docker-compose.yml run --rm e2e`. They spawn the actual CLI binary as a subprocess and verify exit codes, stdout/stderr JSON shape, and cross-command behaviour. Docker must be running; no other host dependencies are required.

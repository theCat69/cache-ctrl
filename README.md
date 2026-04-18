# cache-ctrl

A CLI tool that manages the two AI agent caches (`.ai/external-context-gatherer_cache/` and `.ai/local-context-gatherer_cache/`) with a uniform interface.

It handles advisory locking for safe concurrent writes, keyword search across all entries, and file-change detection for local scans.

---

## Quick Start

### npm (recommended)

```sh
npm install -g @thecat69/cache-ctrl
cache-ctrl install
```

`cache-ctrl install` configures OpenCode skills in one step:
- Copies 3 skill SKILL.md files to `~/.config/opencode/skills/`.

**Prerequisites**: `bun` ≥ 1.0.0 must be in `PATH` (Bun executes the TypeScript files natively — no build step).

### Local development (from source)

Run from inside the `cache-ctrl/` directory:

```zsh
zsh install.sh
```

This creates a CLI symlink and skill symlinks:
- `~/.local/bin/cache-ctrl` → `bin/cache-ctrl.js` — global CLI command (executed directly by Bun)

`install.sh` is for local development only. For end-user installation, use `npm install -g @thecat69/cache-ctrl`.

---

## Architecture

```
CLI (cache-ctrl)
bin/cache-ctrl.js
     │
     │
  src/index.ts
     │
     │
Command Layer
   src/commands/{list, inspectExternal,
           inspectLocal, flush, invalidate,
       touch, prune,
       checkFiles, search, writeLocal,
       writeExternal, install,
       graph, map, watch, version}.ts
                 │
           Core Services
    cacheManager  ← read/write + advisory lock
    externalCache ← external staleness logic
    localCache    ← local scan path logic
    graphCache    ← graph.json read/write path
    platform/xdg  ← XDG cache dir resolver
    http/parserDownloader ← on-demand WASM parser download + atomic cache
    changeDetector   ← mtime/hash comparison
   keywordSearch    ← scoring engine
   analysis/symbolExtractor ← Tree-sitter symbol extraction (multi-language)
   analysis/treeSitterEngine ← web-tree-sitter WASM parser runtime
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
- All operations return `Result<T, CacheError>` — nothing throws into the caller.
- `writeCache` defaults to merging updates onto the existing object (preserving unknown agent fields). Local writes use per-path merge — submitted `tracked_files` entries replace existing entries for those paths; entries for other paths are preserved; entries for files no longer present on disk are evicted automatically.
- `write.ts` is a thin router; all business logic lives in `writeLocal.ts`, `writeExternal.ts`, `inspectLocal.ts`, `inspectExternal.ts`.

---

## CLI Reference

**Output format**: JSON (single line) by default. Add `--pretty` to any command for indented output.  
**Success envelope**: Every successful response includes an `"ok": true` field, a `"value"` field containing the command payload, and a `"serverTime"` field (ISO 8601 UTC string) at the top level — except the `install` command, which omits `serverTime`.  
**Errors**: Written to stderr as JSON. Exit code `1` on error, `2` on bad arguments. Example:

```json
{
  "ok": false,
  "code": "VALIDATION_ERROR",
  "error": "✖ fetched_at must be ISO 8601 UTC ...",
  "issues": [{ "path": "fetched_at", "message": "...", "code": "invalid_string", "received": "..." }],
  "hint": "Required: description (string), fetched_at (ISO 8601 UTC ...), sources (...)"
}
```

**Help**: Run `cache-ctrl --help` or `cache-ctrl help` for the full command reference. Run `cache-ctrl help <command>` for per-command usage, arguments, and options. Help output is plain text written to stdout; exit code `0` on success, `1` for unknown command.

---

### `install`

```
cache-ctrl install [--config-dir <path>]
```

Configures OpenCode integration after `npm install -g @thecat69/cache-ctrl`. Does two things:

1. **Copies 3 skill files** (`cache-ctrl-caller`, `cache-ctrl-local`, `cache-ctrl-external`) to `~/.config/opencode/skills/`.

`cache-ctrl install` is now skills-only: no tool wrapper is generated.

The operation is idempotent — re-running `cache-ctrl install` refreshes the installed skill files.

**OpenCode config directory resolution** (in priority order):
1. `--config-dir <path>` flag (explicit override; relative paths are resolved to absolute paths)
2. `~/.config/opencode`

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
    "skillPaths": [
      "/home/user/.config/opencode/skills/cache-ctrl-caller/SKILL.md",
      "/home/user/.config/opencode/skills/cache-ctrl-local/SKILL.md",
      "/home/user/.config/opencode/skills/cache-ctrl-external/SKILL.md"
    ]
  }
}
```

**Error codes**: `INVALID_ARGS` if `--config-dir` resolves outside the user's home directory; `FILE_WRITE_ERROR` if a skill file cannot be written.

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
  ],
  "serverTime": "2026-04-15T12:00:00.000Z"
}
```

---

### `inspect-external`

```
cache-ctrl inspect-external <subject-keyword> [--pretty]
```

Prints the full JSON content of the best-matching **external** cache entry. Uses the same keyword scoring as `search`. Returns `AMBIGUOUS_MATCH` if two results score identically. The `<subject-keyword>` is validated with `validateSubject()` before use.

```
cache-ctrl inspect-external opencode-skills --pretty
```

---

### `inspect-local`

```
cache-ctrl inspect-local [--filter <kw>[,<kw>...]] [--folder <path>] [--search-facts <kw>[,<kw>...]] [--pretty]
```

Prints the full JSON content of the local context cache (`context.json`). No subject argument is required.

Three complementary filters restrict which `facts` entries are returned — they are AND-ed when combined:

**`--filter <kw>[,<kw>...]`**: restricts `facts` to entries whose **file path** contains at least one keyword (case-insensitive substring). Each keyword must be 1–256 characters.

**`--folder <path>`**: restricts `facts` to entries whose **file path** equals the given folder prefix or starts with `<folder>/` (recursive subtree match).

**`--search-facts <kw>[,<kw>...]`**: restricts `facts` to entries where **at least one fact string** contains any keyword (case-insensitive substring). Each keyword must be 1–256 characters.

`global_facts` and all other metadata fields are always included regardless of which filters are set.

**`tracked_files` is never returned** — it is internal operational metadata consumed by `check-files` and is always stripped from inspect responses.

When **no filters are provided** the full `facts` map is returned and the response includes a `warning` field:

```json
{ "warning": "No filters provided: returning full facts map. This may exceed token limits for large codebases." }
```

Unfiltered calls that produce a response larger than **20,000 UTF-8 bytes** or more than **500 `facts` entries** are rejected with `ok: false` and `code: PAYLOAD_TOO_LARGE`. For unfiltered responses under those limits, the `warning` field above is still included.

Prefer using at least one filter for large codebases.

> `--search-facts ""` (empty string) and `--filter` with no value return exit code `2` with `INVALID_ARGS`.

```
cache-ctrl inspect-local --pretty
cache-ctrl inspect-local --filter lsp,nvim --pretty
cache-ctrl inspect-local --folder src/commands --pretty
cache-ctrl inspect-local --search-facts "Result<" --pretty
cache-ctrl inspect-local --folder src --filter commands --search-facts async --pretty
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

**Duration format**: `<number><unit>` — `s` for seconds, `m` for minutes, `h` for hours, `d` for days. Examples: `30s`, `15m`, `24h`, `7d`.

**Defaults**: `--agent all`, `--max-age 24h` for external. Local cache **always** matches (no TTL).

> If the local cache does not exist and `--delete` is not set, the local entry is skipped silently (not added to `matched`).

> ⚠️ `prune --agent all --delete` will **always** delete the local cache. Use `--agent external` to avoid this.

```
cache-ctrl prune --agent external --max-age 7d
cache-ctrl prune --agent external --max-age 1d --delete
```

---

### `check-files`

```
cache-ctrl check-files [--include-unchanged] [--pretty]
```

Reads `tracked_files[]` from the local cache and compares each file's current `mtime` (and `hash` if stored) against the saved values.

**Comparison logic:**
1. Read current `mtime` via `lstat()` (reflects the symlink node itself, not the target).
2. If stored `hash` is present and `mtime` changed → recompute SHA-256. Hash match → `unchanged` (touch-only). Hash differs → `changed`.
3. No stored `hash` → mtime change alone marks the file as `changed`.
4. File missing on disk → `missing`.

If `tracked_files` is absent or empty → returns `{ status: "unchanged", ... }` (not an error).

By default, `unchanged_files` is omitted from output to reduce payload size. Pass `--include-unchanged` to include it.

```jsonc
// cache-ctrl check-files --pretty
{
  "ok": true,
  "value": {
    "status": "unchanged",
    "changed_files": [],
    "missing_files": [],
    "new_files": [],
    "deleted_git_files": []
  },
  "serverTime": "2026-04-15T12:00:00.000Z"
}
```

```jsonc
// cache-ctrl check-files --include-unchanged --pretty
{
  "ok": true,
  "value": {
    "status": "unchanged",
    "changed_files": [],
    "unchanged_files": ["lua/plugins/ui/bufferline.lua"],
    "missing_files": [],
    "new_files": [],
    "deleted_git_files": []
  },
  "serverTime": "2026-04-15T12:00:00.000Z"
}
```

`new_files` lists non-ignored files absent from cache (includes git-tracked and untracked non-ignored files). `deleted_git_files` lists git-tracked files removed from the working tree.

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

### `write-local` / `write-external`

```
cache-ctrl write-external <subject> --data '<json>' [--pretty]
cache-ctrl write-local --data '<json>' [--pretty]
```

Writes a validated cache entry to disk. `write-external` validates the external payload together with the positional `subject` argument, while `write-local` validates the LocalCacheFile payload provided in `--data`. Validation runs first; missing required fields in the relevant validated inputs are rejected with `VALIDATION_ERROR`.

- `external`: `subject` is required as a positional argument. After validation, unknown fields from the existing file on disk are preserved (merge write).
- `local`: no subject argument; `timestamp` is **auto-set** to the current UTC time server-side — any value supplied in `--data` is silently overridden. `mtime` for each entry in `tracked_files[]` is **auto-populated** by the write command via filesystem `lstat()` — agents do not need to supply it. Local writes use per-path merge: submitted `tracked_files` entries replace existing entries for the same path; entries for other paths are preserved; entries for files deleted from disk are evicted automatically. On cold start (no existing cache), submit all relevant files for a full write; on subsequent writes, submit only new or changed files.
- `local`: facts paths are validated against submitted `tracked_files` — submitting a facts key outside that set returns `VALIDATION_ERROR`.

> `VALIDATION_ERROR` messages include the offending field path (e.g., `facts.src/foo.ts.2: write concise observations, not file content (max 300 chars per fact)`), making it straightforward to locate the violating value.

> The `subject` parameter (external agent) must match `/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/` and be at most 128 characters. Returns `INVALID_ARGS` if it fails validation.

**Always use these commands (or `cache_ctrl_write_local` / `cache_ctrl_write_external`) instead of writing cache files directly.** Direct writes skip schema validation and risk corrupting the cache.

Shell JSON escaping guidance for `--data`:

- **bash / zsh**: wrap JSON in single quotes `'...'`. If JSON includes a literal apostrophe (`'`), prefer file-generated compact JSON; inline fallback is the standard `\''` pattern.
- **PowerShell (Windows preferred)**: wrap JSON in single quotes `'...'`; if JSON contains `'`, escape as `''`.
- **cmd.exe (fragile fallback only)**: inline JSON is error-prone. `%VAR%` expands before execution, and `!VAR!` also expands when delayed expansion is enabled. Prefer PowerShell or file-generated JSON on Windows.

For large, quote-heavy payloads, or apostrophes in JSON text, prefer file-generated compact JSON over inline literals.

Examples (per shell):

```bash
cache-ctrl write-external opencode-skills --data '{"description":"Skill index","fetched_at":"2026-04-05T10:00:00Z","sources":[{"type":"github_api","url":"https://api.github.com/repos/owner/repo/contents/.opencode/skills"}]}'
cache-ctrl write-local --data '{"topic":"src scan","description":"Local scan","tracked_files":[{"path":"src/index.ts"}]}'
```

```zsh
cache-ctrl write-external opencode-skills --data '{"description":"Skill index","fetched_at":"2026-04-05T10:00:00Z","sources":[{"type":"github_api","url":"https://api.github.com/repos/owner/repo/contents/.opencode/skills"}]}'
cache-ctrl write-local --data '{"topic":"src scan","description":"Local scan","tracked_files":[{"path":"src/index.ts"}]}'
```

```powershell
cache-ctrl write-external opencode-skills --data '{"description":"Skill index","fetched_at":"2026-04-05T10:00:00Z","sources":[{"type":"github_api","url":"https://api.github.com/repos/owner/repo/contents/.opencode/skills"}]}'
cache-ctrl write-local --data '{"topic":"src scan","description":"Local scan","tracked_files":[{"path":"src/index.ts"}]}'
```

```cmd
:: Fallback only — fragile with %VAR% / !VAR! expansion
cache-ctrl write-external opencode-skills --data "{\"description\":\"Skill index\",\"fetched_at\":\"2026-04-05T10:00:00Z\",\"sources\":[{\"type\":\"github_api\",\"url\":\"https://api.github.com/repos/owner/repo/contents/.opencode/skills\"}]}"
cache-ctrl write-local --data "{\"topic\":\"src scan\",\"description\":\"Local scan\",\"tracked_files\":[{\"path\":\"src/index.ts\"}]}"
```

```json
// cache-ctrl write-external mysubject --data '{"description":"...","fetched_at":"2026-04-05T10:00:00Z","sources":[]}' --pretty
{ "ok": true, "value": { "file": "/path/to/.ai/external-context-gatherer_cache/mysubject.json" }, "serverTime": "2026-04-15T12:00:00.000Z" }
```

---

### `graph`

```
cache-ctrl graph [--max-tokens <number>] [--seed <path>[,<path>...]] [--pretty]
```

Returns a PageRank-ranked dependency graph within a token budget. Reads from `graph.json` computed by the `watch` daemon. Files are ranked by their centrality in the import graph; use `--seed` to personalize the ranking toward specific files (e.g. recently changed files).

Graph analysis is multi-language via Tree-sitter parsers: TypeScript, JavaScript, Python, Rust, Go, Java, C, and C++. Dependency extraction is intentionally file-local/relative-path focused (e.g., relative imports/includes); package/module registry resolution is out of scope.

On first use, parser WASM files are downloaded and cached at `~/.cache/cache-ctrl/parsers/` (respects `$XDG_CACHE_HOME`).

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
        "deps": ["src/validation.ts"],
        "defs": ["readCache", "writeCache", "findRepoRoot"],
        "ref_count": 12
      }
    ],
    "total_files": 36,
    "computed_at": "2026-04-11T10:00:00Z",
    "token_estimate": 487,
    "entries_skipped": 5 // present only when token budget truncated output
  },
  "serverTime": "2026-04-15T12:00:00.000Z"
}
```

`entries_skipped` is present (and non-zero) when the token budget truncated the ranked list; absent when all files fit within the budget.

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

Returns `PAYLOAD_TOO_LARGE` if the serialized output exceeds **20 000 UTF-8 bytes**. Use `--folder` to restrict to a subdirectory, or switch to `--depth overview` instead of `full`.

`--folder` must be a **relative path** (no leading `/`). Rejects `..` segments, null bytes, and strings longer than 512 characters; returns `INVALID_ARGS` otherwise.

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
  },
  "serverTime": "2026-04-15T12:00:00.000Z"
}
```

---

### `watch`

```
cache-ctrl watch [--verbose]
```

Long-running daemon that watches the repo for source file changes and incrementally rebuilds `graph.json`. The analysis engine supports multiple languages via Tree-sitter parsers (TypeScript, JavaScript, Python, Rust, Go, Java, C, C++). On startup it performs an initial full graph build. Subsequent file changes trigger a debounced rebuild (200 ms). Rebuilds are serialized — concurrent changes are queued. Watch filtering now covers all supported parser-backed source extensions: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.h`, `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`.

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

### `version`

```
cache-ctrl version
```

Prints the current package version as JSON and exits.

No flags or arguments.

```jsonc
// cache-ctrl version
{ "ok": true, "value": { "version": "1.1.1" }, "serverTime": "2026-04-15T12:00:00.000Z" }
```

---


## Agent Integration

### `external-context-gatherer`

```zsh
# Before fetching — check if cache is still fresh
cache-ctrl list --agent external --pretty
# If is_stale: false → skip fetch

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

If a local-context-gatherer run reads any changed/new files, it must call `cache-ctrl write-local --data '<json>'` before returning (cache update is mandatory and does not require an explicit user ask).

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
      "deps": ["src/validation.ts", "src/types/result.ts"],
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
| `PAYLOAD_TOO_LARGE` | `inspect-local` unfiltered response exceeds 20 000 bytes or 500 entries; `map` output exceeds 20 000 bytes. Use `--filter`, `--folder`, or `--search-facts`, or navigate with `map`/`graph` first. |
| `UNKNOWN` | Unexpected internal/runtime error (including unexpected HTTP client failures) |

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

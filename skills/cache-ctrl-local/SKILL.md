---
name: cache-ctrl-local
description: How to use cache-ctrl to detect file changes and manage the local context cache
---

# cache-ctrl — Local Cache Usage

Manage `.ai/local-context-gatherer_cache/context.json` to avoid redundant full-repo scans.
Three tiers of access — use the best one available.

## Availability Detection (run once at startup)

1. Call `cache_ctrl_check_files` (built-in tool).
   - Success → **use Tier 1** for all operations below.
   - Failure (tool not found / permission denied) → continue to step 2.
2. Run `bash: "which cache-ctrl"`.
   - Exit 0 → **use Tier 2** for all operations below.
   - Not found → **use Tier 3** for all operations below.

---

## Fact-Writing Rules

Per-file `facts` entries are no longer flat string arrays. Each path now maps to a
**`FileFacts` object**:

```json
{
  "summary": "One-sentence description of what this file does",
  "role": "implementation",
  "importance": 2,
  "facts": ["Concise observation 1", "Concise observation 2"]
}
```

Required and recommended fields:

- **`summary` is mandatory** when writing a file entry. Keep it to one sentence.
- **`role` is mandatory** when writing a file entry. Must be one of:
  - `entry-point`
  - `interface`
  - `implementation`
  - `test`
  - `config`
- **`importance` is optional but strongly recommended**:
  - `1` = core module
  - `2` = supporting module
  - `3` = peripheral/config module
- **`facts` is optional** and capped at **10 items**, each **≤ 300 chars**.

Content quality rules:

- **Never write** raw import lines, function bodies, code snippets, or verbatim text from the file.
- **Do write** concise architectural observations: purpose, key exports, constraints, dependencies, notable patterns.

**Good `facts[]` item** ✅:
> `"Delegates local writes to writeLocalCommand and preserves unrelated paths through per-path merge"`

**Bad `facts[]` item** ❌:
> `"import { ExternalCacheFileSchema, LocalCacheFileSchema } from '../types/cache.js'; import { ErrorCode, Result } from '../types/result.js'"` ← raw file content

**Global facts** are for cross-cutting structural observations only (e.g. CLI entry pattern, installation steps). Max 20, each ≤ 300 chars. Only update global_facts when you re-read a structural file (AGENTS.md, install.sh, package.json, *.toml, opencode.json).

---

## Mandatory: Write Before Return

**Every invocation that reads any file MUST call `cache_ctrl_write_local` before returning — no exceptions, no edge cases.**

Sequential checklist (do not skip any step):

1. Call `cache_ctrl_check_files` — identify changed/new files
2. Read only the changed/new files (skip unchanged ones)
3. Extract concise facts per file (follow Fact-Writing Rules above)
4. **Call `cache_ctrl_write_local` — MANDATORY. NO EXCEPTIONS.** (even if only 1 file changed, even if only global_facts changed, even if you believe the facts are identical to what is cached)
5. Return your summary

> **⛔ Write-or-fail rule**: If you read any file in steps 2–3, you MUST call `cache_ctrl_write_local` in step 4. Returning without writing after reading files is a critical failure — the cache will be stale and the orchestrator will detect the missing write and re-invoke you. Even if zero files were read, you must still consult the decision table below before deciding to skip the write.

**The only time you may skip `cache_ctrl_write_local` is when ALL of the following are true simultaneously:**

| Condition | Required value |
|---|---|
| `changed_files` from `cache_ctrl_check_files` | empty `[]` |
| `new_files` from `cache_ctrl_check_files` | empty `[]` |
| No files were force-requested by the caller | true |
| Cache already exists and is non-empty | true |
| This invocation was NOT triggered by a cache invalidation | true |

If any one of these conditions is not met, you **must** write.

---

## Startup Workflow

### 1. Check if tracked files changed

**Tier 1:** Call `cache_ctrl_check_files` (no parameters).
**Tier 2:** `cache-ctrl check-files`
**Tier 3:** `read` `.ai/local-context-gatherer_cache/context.json`.
  - File absent → cold start, proceed to scan.
  - File present → check `timestamp`. If older than 1 hour, treat as stale and re-scan. Otherwise treat as fresh.

Result interpretation (Tier 1 & 2):
- `status: "unchanged"` → tracked files are content-stable; skip re-scan and return cached context.
- `status: "changed"` → at least one tracked file changed; proceed to **delta scan** (read content of `changed_files` + `new_files` only — do not re-read unchanged files).
- `status: "unchanged"` with empty `tracked_files` → cold start, proceed to scan.

The response also reports:
- `new_files` — untracked non-ignored files absent from cache, plus git-tracked files absent from cache when the cache is non-empty (blank-slate caches skip git-tracked files to avoid false positives on cold start)
- `deleted_git_files` — git-tracked files deleted from the working tree (reported by `git ls-files --deleted`)

> **⚠ Cache is non-exhaustive**: `status: "unchanged"` only confirms that previously-tracked files are content-stable — it does not mean the file set is complete. Always check `new_files` and `deleted_git_files` in the response; if either is non-empty, include those paths in the next write to keep the cache up to date.

### 2. Invalidate before writing (optional)

> Do this only if cache is really outdated and a full rescan is needed. Otherwise just proceed with next step (writing).

**Tier 1:** Call `cache_ctrl_invalidate` with `agent: "local"`.
**Tier 2:** `cache-ctrl invalidate local`
**Tier 3:** Skip — overwriting the file in step 3 is sufficient.

### 3. Write cache after scanning

**Always use the write tool/command — never edit the file directly.** Direct writes bypass schema validation and can silently corrupt the cache format.

> **Write is per-path merge**: Submitted `tracked_files` entries replace existing entries for the same paths. Paths not in the submission are preserved. Entries for files deleted from disk are evicted automatically (no agent action needed).

#### Input fields (top-level args)

| Field | Type | Required | Notes |
|---|---|---|---|
| `topic` | `string` | ✅ | Human description of what was scanned |
| `description` | `string` | ✅ | One-liner for keyword search |
| `tracked_files` | `Array<{ path: string }>` | ✅ | Paths to track; `mtime` and `hash` are auto-computed by the tool |
| `global_facts` | `string[]` | optional | Repo-level facts; last-write-wins; see trigger rule below |
| `facts` | `Record<string, FileFacts>` | optional | Per-file structured facts keyed by path; per-path merge |
| `cache_miss_reason` | `string` | optional | Why the previous cache was discarded |

> **Cold start vs incremental**: On first run (no existing cache), submit all relevant files. On subsequent runs, submit only new and changed files — the tool merges them in.

> **Auto-set by the tool — do not include**: `timestamp` (current UTC), `mtime` (filesystem `lstat()`), and `hash` (SHA-256) per `tracked_files` entry.

### Scope rule for `facts`

Submit `facts` ONLY for files you actually read in this session (i.e., files present in
your submitted `tracked_files`). Never reconstruct or re-submit facts for unchanged files —
the tool preserves them automatically via per-path merge.

Submitting a facts key for a path absent from submitted `tracked_files` is a
VALIDATION_ERROR and the entire write is rejected.

### Fact completeness

When a file appears in `changed_files` or `new_files`, read the **whole file** before writing
facts — not just the diff. A 2-line change does not support a complete re-description of the
file, and submitting partial facts for a re-read path **permanently replaces** whatever was
cached before.

Write facts as **enumerable observations** — one entry per notable characteristic (purpose,
structure, key dependencies, patterns, constraints, entry points). Do not bundle multiple
distinct properties into a single string. A file should have as many fact entries as it has
distinct notable properties, up to the 10-item limit.

Each per-file `facts` entry MUST include `summary` + `role`, should include `importance`,
and may include an optional `facts[]` list.

#### `cache_ctrl_write_local` facts shape example (`FileFacts`)

```json
{
  "facts": {
    "src/commands/write.ts": {
      "summary": "Thin router dispatching write calls to writeLocal or writeExternal based on agent type.",
      "role": "implementation",
      "importance": 2,
      "facts": [
        "Delegates to writeLocalCommand for agent=local",
        "Delegates to writeExternalCommand for all other agents"
      ]
    }
  }
}
```

### When to submit `global_facts`

Submit `global_facts` only when you re-read at least one structural file in this session:
AGENTS.md, install.sh, opencode.json, package.json, *.toml config files.

If none of those are in `changed_files` or `new_files`, omit `global_facts` from the write.
The existing value is preserved automatically.

### Eviction

Facts for files deleted from disk are evicted automatically on the next write — no agent
action needed. `global_facts` is never evicted.

#### Tier 1 — `cache_ctrl_write_local`

```json
{
  "topic": "neovim plugin configuration scan",
  "description": "Full scan of lua/plugins tree for neovim lazy.nvim setup",
  "tracked_files": [
    { "path": "lua/plugins/ui/bufferline.lua" },
    { "path": "lua/plugins/lsp/nvim-lspconfig.lua" }
  ]
}
```

#### Tier 2 — CLI

`cache-ctrl write-local --data '<json>'` — pass the same top-level fields as the JSON value.

#### Tier 3

Not available — there is no direct-file fallback for writes. If neither Tier 1 nor Tier 2 is accessible, request access to one of them.

### 4. Confirm cache (optional)

**Tier 1:** Call `cache_ctrl_list` with `agent: "local"` to confirm the entry was written.
**Tier 2:** `cache-ctrl list --agent local`
**Tier 3:** `read` `.ai/local-context-gatherer_cache/context.json` and verify `timestamp` is current.

Note: local entries show `is_stale: true` only when `cache_ctrl_check_files` detects actual changes (changed files, new non-ignored files, or deleted files). A freshly-written cache with no subsequent file changes will show `is_stale: false`.

---

## Tool / Command Reference

| Operation | Tier 1 (built-in) | Tier 2 (CLI) | Tier 3 (manual) |
|---|---|---|---|
| Detect file changes | `cache_ctrl_check_files` | `cache-ctrl check-files` | read `context.json`, check `timestamp` |
| Invalidate cache | `cache_ctrl_invalidate` | `cache-ctrl invalidate local` | overwrite file in next step |
| Confirm written | `cache_ctrl_list` | `cache-ctrl list --agent local` | `read` file, check `timestamp` |
| Read facts (filtered) | `cache_ctrl_inspect` with `filter`, `folder`, or `searchFacts` | `cache-ctrl inspect local context --filter <kw>[,<kw>...]` / `--folder <path>` / `--search-facts <kw>[,<kw>...]` | `read` file, extract `facts`/`global_facts` |
| Read all facts (rare) | `cache_ctrl_inspect` (no filter) | `cache-ctrl inspect local context` | `read` file directly |
| Write cache | `cache_ctrl_write_local` | `cache-ctrl write-local --data '<json>'` | ❌ not available |

## New Tooling: `cache_ctrl_map` and `cache_ctrl_graph`

### `cache_ctrl_map`

- **Purpose:** Build a semantic mental map of the codebase (what each file does, plus role/importance metadata).
- **Params:**
  - `depth` (optional):
    - `overview` (default): ~300-token orientation (summaries + roles)
    - `modules`: adds module/grouping information
    - `full`: includes per-file `facts[]` arrays
  - `folder` (optional): restrict output to a path prefix
- **When to use:** first call when entering a new task, before deeper inspection.

### `cache_ctrl_graph`

- **Purpose:** Return a structural dependency graph with PageRank-ranked files by centrality.
- **Params:**
  - `maxTokens` (optional, default `1024`)
  - `seed` (optional `string[]`): personalize ranking toward specific files (for example changed files)
- **Requirements:** `cache-ctrl watch` must be running (or must have run recently) to populate `graph.json`.
- **When to use:** after `cache_ctrl_map`, to identify the most connected/high-leverage files.

## Recommended Brain-Agent Protocol (Progressive Disclosure)

Use this 4-step sequence to control token usage while preserving accuracy:

1. `cache_ctrl_map(depth: "overview")` — orient quickly (~300 tokens)
2. `cache_ctrl_graph(maxTokens: 1024, seed: [changedFiles])` — structural dependency view
3. `cache_ctrl_inspect(filter: [...])` — deep facts for specific files
4. Read only the relevant source files (typically 2–5 files)

> **⚠ Always use at least one filter when reading facts for a specific task.** Three targeting options are available — use the most specific one that fits your task:
>
> | Flag | What it matches | Best for |
> |---|---|---|
> | `--filter <kw>` | File path contains keyword | When you know which files by name/path segment |
> | `--folder <path>` | File path starts with folder prefix (recursive) | When you need all files in a directory subtree |
> | `--search-facts <kw>` | Any fact string contains keyword | When you need files related to a concept, pattern, or API |
>
> The flags are AND-ed when combined. Omit all filters only when you genuinely need facts for the entire repository (rare — e.g. building a full index; only appropriate for ≤ ~20 tracked files). An unfiltered `inspect` on a large repo can return thousands of fact strings.

> **`tracked_files` is never returned by `inspect` for the local agent.** It is internal operational metadata consumed by `check-files`. It will not appear in any inspect response.

## server_time in Responses

Every `cache_ctrl_*` tool call returns a `server_time` field at the outer JSON level:

```json
{ "ok": true, "value": { ... }, "server_time": "2026-04-05T12:34:56.789Z" }
```

Use this to assess how stale stored timestamps are — you do not need `bash` or system access to know the current time.

## Cache Location

`.ai/local-context-gatherer_cache/context.json` — single file, no per-subject splitting.

No time-based TTL for Tier 1/2. Freshness determined by `cache_ctrl_check_files`.
Tier 3 uses a 1-hour `timestamp` TTL as a rough proxy.

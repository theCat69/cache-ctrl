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

Facts must be **concise observations** about a file — not reproductions of its content.

- **Each fact string must be ≤ 300 characters** (schema hard limit: 800). If an observation needs more, split it into two facts or summarize.
- **Max 30 facts per file.** Choose only the most architecturally meaningful observations.
- **Never write**: raw import lines, function bodies, code snippets, or verbatim text from the file.
- **Do write**: what the file exports, what pattern it uses, what dependencies it has, what its responsibility is.

**Good fact** ✅:
> `"Exports writeCommand — validates subject, merges per-path facts atomically, returns Result<WriteResult>"`

**Bad fact** ❌:
> `"import { ExternalCacheFileSchema, LocalCacheFileSchema } from '../types/cache.js'; import { ErrorCode, Result } from '../types/result.js'; import { WriteArgs, WriteResult } from '../types/commands.js'"` ← this is raw file content

**Global facts** are for cross-cutting structural observations only (e.g. CLI entry pattern, installation steps). Max 20, each ≤ 300 chars. Only update global_facts when you re-read a structural file (AGENTS.md, install.sh, package.json, *.toml, opencode.json).

---

## Mandatory: Write Before Return

**Every invocation must call `cache_ctrl_write` before returning.** Returning without writing is a failure — the orchestrator will detect the missing write and re-invoke you.

Sequential checklist (do not skip any step):

1. Call `cache_ctrl_check_files` — identify changed/new files
2. Read only the changed/new files (skip unchanged ones)
3. Extract concise facts per file (follow Fact-Writing Rules above)
4. **Call `cache_ctrl_write` — MANDATORY** (even if only 1 file changed, even if only global_facts changed)
5. Return your summary

If there are no changed files, the cache already exists and is non-empty, **and you were not invoked after a cache invalidation**, you may skip the write — but only in this case.

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

#### Input fields (`content` object)

| Field | Type | Required | Notes |
|---|---|---|---|
| `topic` | `string` | ✅ | Human description of what was scanned |
| `description` | `string` | ✅ | One-liner for keyword search |
| `tracked_files` | `Array<{ path: string }>` | ✅ | Paths to track; `mtime` and `hash` are auto-computed by the tool |
| `global_facts` | `string[]` | optional | Repo-level facts; last-write-wins; see trigger rule below |
| `facts` | `Record<string, string[]>` | optional | Per-file facts keyed by path; per-path merge |
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
distinct notable properties, not a prose summary compressed into one or two lines.

### When to submit `global_facts`

Submit `global_facts` only when you re-read at least one structural file in this session:
AGENTS.md, install.sh, opencode.json, package.json, *.toml config files.

If none of those are in `changed_files` or `new_files`, omit `global_facts` from the write.
The existing value is preserved automatically.

### Eviction

Facts for files deleted from disk are evicted automatically on the next write — no agent
action needed. `global_facts` is never evicted.

#### Tier 1 — `cache_ctrl_write`

```json
{
  "agent": "local",
  "content": {
    "topic": "neovim plugin configuration scan",
    "description": "Full scan of lua/plugins tree for neovim lazy.nvim setup",
    "tracked_files": [
      { "path": "lua/plugins/ui/bufferline.lua" },
      { "path": "lua/plugins/lsp/nvim-lspconfig.lua" }
    ]
  }
}
```

#### Tier 2 — CLI

`cache-ctrl write local --data '<json>'` — pass the same `content` object as JSON string.

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
| Read facts (filtered) | `cache_ctrl_inspect` with `filter` | `cache-ctrl inspect local context --filter <kw>[,<kw>...]` | `read` file, extract `facts`/`global_facts` |
| Read all facts (rare) | `cache_ctrl_inspect` (no filter) | `cache-ctrl inspect local context` | `read` file directly |
| Write cache | `cache_ctrl_write` | `cache-ctrl write local --data '<json>'` | ❌ not available |

> **⚠ Always use `--filter` when reading facts for a specific task.** Pass keywords derived from your current goal (e.g. `filter: ["lsp"]`, `filter: ["install", "zsh"]`). Omit `--filter` only when you genuinely need facts for the entire repository (rare — e.g. building a full index). An unfiltered `inspect` on a large repo can return thousands of fact strings.

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

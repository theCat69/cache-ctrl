---
name: cache-ctrl-local
description: How to use cache-ctrl to detect file changes and manage the local context cache
---

# cache-ctrl — Local Cache Usage

## Fact-Writing Rules

Per-file entries use the `FileFacts` object shape:

```json
{
  "summary": "One-sentence description of what this file does",
  "role": "implementation",
  "importance": 2,
  "facts": ["Concise observation 1", "Concise observation 2"]
}
```

Fields:
- **`summary`** — mandatory. One sentence.
- **`role`** — mandatory. One of: `entry-point`, `interface`, `implementation`, `test`, `config`.
- **`importance`** — strongly recommended. `1` = core, `2` = supporting, `3` = peripheral.
- **`facts`** — optional. Max 10 items, each ≤ 300 chars.

Content quality rules:
- **Never write** raw import lines, code snippets, or verbatim file content.
- **Do write** concise architectural observations: purpose, key exports, constraints, dependencies, notable patterns.
- Write facts as **enumerable observations** — one entry per distinct property, up to the 10-item limit.

Good example ✅:
> `"Delegates local writes to writeLocalCommand and preserves unrelated paths through per-path merge"`

Bad example ❌:
> `"import { ExternalCacheFileSchema } from '../types/cache.js'"` ← raw file content

**Global facts** — cross-cutting structural observations only (CLI entry pattern, installation steps, etc.). Max 20, each ≤ 300 chars. Only update `global_facts` when re-reading a structural file: `AGENTS.md`, `install.sh`, `opencode.json`, `package.json`, `*.toml`.

## Scan Workflow

1. Call `cache_ctrl_check_files` to identify changed and new files.
2. Read only the changed/new files (skip unchanged ones).
3. Extract `FileFacts` per file (follow Fact-Writing Rules above).
4. Call `cache_ctrl_write_local` — **mandatory** (see Write-Before-Return Rule below for the skip exception).
5. Return your summary.

> **⚠ Cache is non-exhaustive:** `status: "unchanged"` only confirms previously-tracked files are stable — it does not mean the file set is complete. Always check `new_files` and `deleted_git_files` in the response.

## Write-Before-Return Rule

**Every invocation that reads any file MUST call `cache_ctrl_write_local` before returning.**

The only time you may skip the write is when ALL of the following are true:

| Condition | Required value |
|---|---|
| `changed_files` from `check_files` | `[]` |
| `new_files` from `check_files` | `[]` |
| No files were force-requested by caller | true |
| Cache already exists and is non-empty | true |
| This invocation was NOT triggered by a cache invalidation | true |

If any condition is not met, you **must** write.

> **⛔ Write-or-fail:** Returning without writing after reading files is a critical failure — the cache will be stale. Even if you believe facts are unchanged, if you read a file, you write.

## `cache_ctrl_write_local` Reference

Always use `cache_ctrl_write_local` — never write cache files directly.

#### Input fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `topic` | `string` | ✅ | Human description of what was scanned |
| `description` | `string` | ✅ | One-liner for keyword search |
| `tracked_files` | `Array<{ path: string }>` | ✅ | `mtime` and `hash` are auto-computed |
| `facts` | `Record<string, FileFacts>` | optional | Per-file structured facts; per-path merge |
| `global_facts` | `string[]` | optional | Last-write-wins; see trigger rule above |
| `cache_miss_reason` | `string` | optional | Why prior cache was discarded |

> **Auto-set by the tool — do not include:** `timestamp`, `mtime`, `hash`.
> **Write is per-path merge:** Submitted paths replace existing entries for those paths. Other paths are preserved. Deleted-file entries are evicted automatically.

#### Scope rule for `facts`

Submit `facts` ONLY for files you actually read in this session (files present in `tracked_files`). Never reconstruct or re-submit facts for unchanged files — the tool preserves them automatically.

Submitting a `facts` key for a path absent from `tracked_files` is a `VALIDATION_ERROR` and the entire write is rejected.

#### Fact completeness

When a file appears in `changed_files` or `new_files`, read the **whole file** before writing facts — not just the diff. Submitting partial facts for a re-read path **permanently replaces** whatever was cached.

#### Example

```json
{
  "topic": "src/commands scan",
  "description": "Scan of src/commands after write refactor",
  "tracked_files": [
    { "path": "src/commands/writeLocal.ts" }
  ],
  "facts": {
    "src/commands/writeLocal.ts": {
      "summary": "Thin router dispatching write calls based on agent type.",
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

## Eviction

Facts for files deleted from disk are evicted automatically on the next write — no agent action needed. `global_facts` is never evicted.

## Tool Reference

| Operation | Tool |
|---|---|
| Detect file changes | `cache_ctrl_check_files` |
| Invalidate cache | `cache_ctrl_invalidate` (agent: "local") |
| Write cache | `cache_ctrl_write_local` |
| Read facts (filtered) | `cache_ctrl_inspect` (agent: "local", filter / folder / search_facts) |
| Confirm written | `cache_ctrl_list` (agent: "local") |

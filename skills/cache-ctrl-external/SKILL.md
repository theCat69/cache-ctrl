---
name: cache-ctrl-external
description: How to use cache-ctrl to check staleness, search, and manage the external context cache
---

# cache-ctrl — External Cache Usage

Manage `.ai/external-context-gatherer_cache/` to avoid redundant HTTP fetches.
Two tiers of access — use the best one available.

> Availability Detection: see `cache-ctrl-caller`.

---

## Startup Workflow

### 1. Check freshness before fetching

**Tier 1:** Call `cache_ctrl_list` with `agent: "external"`.
**Tier 2:** `cache-ctrl list --agent external`

- Entry for target subject is fresh → **skip fetching, return cached content**.
- Entry is stale or absent → proceed to step 2.

For borderline cases (entry recently turned stale):

**Tier 1:** Call `cache_ctrl_check_freshness` with the subject keyword.
**Tier 2:** `cache-ctrl check-freshness <subject-keyword>`

- `overall: "fresh"` (Tier 1/2) → skip fetch.
- `overall: "stale"` / `"error"` → proceed to fetch.

### 2. Search before creating a new subject

Before fetching a brand-new subject, check whether related info is already cached.

**Tier 1:** Call `cache_ctrl_search` with relevant keywords.
**Tier 2:** `cache-ctrl search <keyword> [<keyword>...]`

### 3. Write cache after fetching

**Always use the write tool/command — never write cache files directly.** Direct writes bypass schema validation and can silently corrupt the cache format.

**Tier 1:** Call `cache_ctrl_write_external` with:
```json
{
  "subject": "<subject>",
  "description": "<one-line summary>",
  "fetched_at": "<ISO 8601 now>",
  "sources": [{ "type": "<type>", "url": "<canonical-url>" }],
  "header_metadata": {}
}
```

**Tier 2:** `cache-ctrl write-external <subject> --data '<json>'`

#### ExternalCacheFile schema

All fields are validated on write. Unknown extra fields are allowed and preserved.

| Field | Type | Required | Notes |
|---|---|---|---|
| `subject` | `string` | ✅ | Must match the file stem (filename without `.json`) |
| `description` | `string` | ✅ | One-liner for keyword search |
| `fetched_at` | `string` | ✅ | ISO 8601 datetime. Use `""` when invalidating |
| `sources` | `Array<{ type: string; url: string; version?: string }>` | ✅ | Empty array `[]` is valid |
| `header_metadata` | `Record<url, { etag?: string; last_modified?: string; checked_at: string; status: "fresh"\|"stale"\|"unchecked" }>` | ✅ | Use `{}` on first write |
| *(any other fields)* | `unknown` | ➕ optional | Preserved unchanged |

**Minimal valid example:**
```json
{
  "subject": "opencode-skills",
  "description": "Index of opencode skill files in the dotfiles repo",
  "fetched_at": "2026-04-05T10:00:00Z",
  "sources": [{ "type": "github_api", "url": "https://api.github.com/repos/owner/repo/contents/.opencode/skills" }],
  "header_metadata": {}
}
```

### 4. Force a re-fetch

**Tier 1:** Call `cache_ctrl_invalidate` with `agent: "external"` and the subject keyword.
**Tier 2:** `cache-ctrl invalidate external <subject-keyword>`

---

## Tool / Command Reference

| Operation | Tier 1 (built-in) | Tier 2 (CLI) |
|---|---|---|
| List entries | `cache_ctrl_list` | `cache-ctrl list --agent external` |
| HTTP freshness check | `cache_ctrl_check_freshness` | `cache-ctrl check-freshness <subject>` |
| Search entries | `cache_ctrl_search` | `cache-ctrl search <kw>...` |
| View full entry | `cache_ctrl_inspect` | `cache-ctrl inspect external <subject>` |
| Invalidate entry | `cache_ctrl_invalidate` | `cache-ctrl invalidate external <subject>` |
| Write entry | `cache_ctrl_write_external` | `cache-ctrl write-external <subject> --data '<json>'` |

## Cache Location

`.ai/external-context-gatherer_cache/<subject>.json` — one file per subject.

Staleness threshold: `fetched_at` is empty **or** older than 24 hours.

> All `cache_ctrl_*` tools return `server_time`; see `cache-ctrl-caller` for freshness-decision usage.

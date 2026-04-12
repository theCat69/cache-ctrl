---
name: cache-ctrl-external
description: How to use cache-ctrl to check staleness, search, and manage the external context cache
---

# cache-ctrl — External Cache Usage

This skill covers managing `.ai/external-context-gatherer_cache/` to avoid redundant HTTP fetches.

## Before Fetching

1. **Optional — survey what's cached**: Call `cache_ctrl_list` (agent: "external") for a full list of existing subjects.
2. **Check if subject is already cached**: Call `cache_ctrl_search` with relevant keywords.
   - Fresh entry found → call `cache_ctrl_inspect_external` to read it and return cached content — **do not fetch**.
   - Entry stale or absent → proceed to fetch.

## Write After Fetching

Always use `cache_ctrl_write_external` — never write cache files directly. Direct writes bypass schema validation and can corrupt the cache.

Call `cache_ctrl_write_external` with:

```json
{
  "subject": "<subject>",
  "description": "<one-line summary>",
  "fetched_at": "<ISO 8601 now>",
  "sources": [{ "type": "<type>", "url": "<canonical-url>" }]
}
```

#### ExternalCacheFile schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `subject` | `string` | ✅ | Must match the file stem |
| `description` | `string` | ✅ | One-liner for keyword search |
| `fetched_at` | `string` | ✅ | ISO 8601. Use `""` when invalidating |
| `sources` | `Array<{ type: string; url: string; version?: string }>` | ✅ | `[]` is valid |
| *(any extra fields)* | `unknown` | optional | Preserved on write |

Minimal valid example:

```json
{
  "subject": "opencode-skills",
  "description": "Index of opencode skill files in the dotfiles repo",
  "fetched_at": "2026-04-05T10:00:00Z",
  "sources": [{ "type": "github_api", "url": "https://api.github.com/repos/owner/repo/contents/.opencode/skills" }]
}
```

## Force Re-Fetch

To force a re-fetch for a specific subject: call `cache_ctrl_invalidate` with `agent: "external"` and the subject keyword.

## Cache Location

`.ai/external-context-gatherer_cache/<subject>.json` — one file per subject.
Staleness threshold: `fetched_at` is empty **or** older than 24 hours.

## Tool Reference

| Operation | Tool |
|---|---|
| List all entries | `cache_ctrl_list` (agent: "external") |
| Search entries | `cache_ctrl_search` |
| Read full entry | `cache_ctrl_inspect_external` |
| Write entry | `cache_ctrl_write_external` |
| Invalidate entry | `cache_ctrl_invalidate` (agent: "external", subject) |

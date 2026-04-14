---
name: cache-ctrl-external
description: How to use cache-ctrl to check staleness, search, and manage the external context cache
---

# cache-ctrl — External Cache Usage

This skill covers managing `.ai/external-context-gatherer_cache/` to avoid redundant HTTP fetches.

## Before Fetching

1. **Optional — survey what's cached**: Run `cache-ctrl list --agent external` for a full list of existing subjects.
2. **Check if subject is already cached**: Run `cache-ctrl search <kw> [<kw>...]` with relevant keywords.
   - Fresh entry found → run `cache-ctrl inspect-external <subject>` to read it and return cached content — **do not fetch**.
   - Entry stale or absent → proceed to fetch.

## Write After Fetching

Always use `cache-ctrl write-external` — never write cache files directly. Direct writes bypass schema validation and can corrupt the cache.

```bash
cache-ctrl write-external <subject> --data '{
  "description": "<one-line summary>",
  "fetched_at": "<ISO 8601 UTC now>",
  "sources": [{ "type": "<type>", "url": "<canonical-url>" }]
}'
```

Note: `subject` is a positional CLI argument (not a field inside `--data`).

#### ExternalCacheFile schema

| Field | Type | Required | Notes |
|---|---|---|---|
| `subject` | `string` | ✅ | Positional CLI arg (`write-external <subject>`) |
| `description` | `string` | ✅ | One-liner for keyword search |
| `fetched_at` | `string` | ✅ | ISO 8601. Use `""` when invalidating |
| `sources` | `Array<{ type: string; url: string; version?: string }>` | ✅ | `[]` is valid |
| *(any extra fields)* | `unknown` | optional | Preserved on write |

Minimal valid CLI example:

```bash
cache-ctrl write-external opencode-skills --data '{
  "description": "Index of opencode skill files in the dotfiles repo",
  "fetched_at": "2026-04-05T10:00:00Z",
  "sources": [{ "type": "github_api", "url": "https://api.github.com/repos/owner/repo/contents/.opencode/skills" }]
}'
```

## Force Re-Fetch

To force a re-fetch for a specific subject, run:

```bash
cache-ctrl invalidate external <subject-kw>
```

## Cache Location

`.ai/external-context-gatherer_cache/<subject>.json` — one file per subject.
Staleness threshold: `fetched_at` is empty **or** older than 24 hours.

## Quick Reference

| Operation | Command |
|---|---|
| List all entries | `cache-ctrl list --agent external` |
| Search entries | `cache-ctrl search <kw> [<kw>...]` |
| Read full entry | `cache-ctrl inspect-external <subject>` |
| Write entry | `cache-ctrl write-external <subject> --data '<json>'` |
| Invalidate entry | `cache-ctrl invalidate external <subject-kw>` |

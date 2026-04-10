# Feature Specification: File-Linked Facts for `local-context-gatherer` Cache

**Project**: `cache-ctrl` CLI + opencode plugin (TypeScript/Bun)  
**Location**: `.config/opencode/custom-tool/cache-ctrl/`  
**Date**: 2026-04-06  
**Status**: Final — ready for implementation

---

## 1. Problem

`context.json` stores all extracted knowledge in a single `description` blob. This blob is **entirely replaced** on every write — including delta scans that only touched a handful of changed files.

Consequences:
- Knowledge about unchanged files is silently discarded on every delta write.
- Cold-start rebuilds lose all previously accumulated context.
- There is no structural connection between *what the agent knows* and *which file it came from*.
- When a file is deleted, there is no targeted eviction — the entire blob must be regenerated.

---

## 2. Solution

Add two new fields to `context.json` that give facts a durable, file-scoped identity:

| Field | Type | Merge behaviour | Eviction |
|---|---|---|---|
| `global_facts` | `string[]` | last-write-wins (same as `topic`) | never |
| `facts` | `Record<string, string[]>` | per-path merge (same as `tracked_files`) | auto-evicted when source file deleted from disk |

A **write-time scope guard** enforces that the agent can only submit facts for files it actually submitted in `tracked_files`. Violations are rejected with `VALIDATION_ERROR` before any disk write occurs.

### Resulting `context.json` shape

```jsonc
{
  "timestamp": "2026-04-06T14:00:00.000Z",
  "topic": "dotfiles repo scan",
  "description": "Kubuntu dotfiles — Neovim, Zsh, opencode, Starship",
  "cache_miss_reason": "files changed",
  "tracked_files": [
    { "path": "lua/plugins/lsp/nvim-lspconfig.lua", "mtime": 1743768000000, "hash": "abc..." }
  ],
  "global_facts": [
    "Kubuntu dotfiles repo",
    "commit format: version / ai|human / purpose : summary",
    "no secrets in repo — sourced from ~/.secrets",
    "StyLua for Lua (140 col, 2-space indent); Biome for TypeScript"
  ],
  "facts": {
    "lua/plugins/lsp/nvim-lspconfig.lua": [
      "configures 12 LSP servers via mason-lspconfig",
      "uses shared on_attach callback for keymaps"
    ],
    "lua/plugins/ui/bufferline.lua": [
      "lazy-loaded via ft = lua",
      "uses catppuccin mocha theme"
    ]
  }
}
```

---

## 3. Scope

### In scope

- `src/types/cache.ts` — schema extension
- `src/commands/write.ts` — scope guard + per-path facts merge + eviction
- `skills/cache-ctrl-local/SKILL.md` — write contract documentation
- `deployable-agents/shared/subagents/local-context-gatherer.md` — agent workflow
- `tests/commands/write.test.ts` — new unit test cases
- `tests/fixtures/local-sample.json` — fixture update
- `e2e/tests/write.e2e.test.ts` — new E2E scenarios
- `README.md` — local cache schema section + `write` command description

### Out of scope

- `check-files` — no change; `changed_files` is already the agent's scope signal
- `invalidate` / `touch` / `prune` — operate on `timestamp` only; not affected
- `inspect` / `list` / `search` — `facts` and `global_facts` flow through as opaque fields
- External cache — entirely unaffected
- Cold-start behaviour — agent scans all files and submits all facts; same as before

---

## 4. Detailed Changes

### 4.1 `src/types/cache.ts`

Extend `LocalCacheFileSchema` with two new optional fields:

```typescript
export const LocalCacheFileSchema = z.looseObject({
  timestamp: z.string(),
  topic: z.string(),
  description: z.string(),
  cache_miss_reason: z.string().optional(),
  tracked_files: z.array(TrackedFileSchema),
  global_facts: z.array(z.string()).optional(),                     // ← NEW
  facts: z.record(z.string(), z.array(z.string())).optional(),     // ← NEW
  // Note: .max() constraints added post-spec — see src/types/cache.ts for current implementation.
});
```

`LocalCacheFile` (inferred type) updates automatically.

---

### 4.2 `src/commands/write.ts`

Three additions to the local write path, executed in this order:

#### Step A — Capture raw submitted paths (refactor of existing loop)

During the `rawTrackedFiles` resolution block, extract a `Set<string>` of all syntactically valid path strings **before** filesystem eviction. This set is the reference for the scope guard in Step B.

```typescript
let guardedPaths = new Set<string>();

if (Array.isArray(rawTrackedFiles)) {
  const validEntries = rawTrackedFiles
    .filter(
      (entry): entry is { path: string } =>
        entry !== null &&
        typeof entry === "object" &&
        typeof (entry as Record<string, unknown>)["path"] === "string",
    )
    .map((entry) => ({ path: entry.path }));

  guardedPaths = new Set(validEntries.map((e) => e.path));  // ← capture here

  const resolved = await resolveTrackedFileStats(validEntries, repoRoot);
  survivingSubmitted = resolved.filter((f) => f.mtime !== 0);
}
```

> **Why raw paths, not `survivingSubmitted`?**  
> The guard's purpose is to verify *agent intent* — "I only submit facts for files I claimed to read." If a submitted file was deleted between `check-files` and the write, the facts merge eviction (Step C) handles cleanup independently. Using raw paths keeps each concern at the right layer.

#### Step B — Scope guard

Insert immediately after Step A, before reading the existing cache:

```typescript
// Guard: submitted facts paths must be a strict subset of submitted tracked_files paths
const rawSubmittedFacts = args.content["facts"];
if (
  rawSubmittedFacts !== null &&
  rawSubmittedFacts !== undefined &&
  typeof rawSubmittedFacts === "object" &&
  !Array.isArray(rawSubmittedFacts)
) {
  const violatingPaths = Object.keys(rawSubmittedFacts as Record<string, unknown>).filter(
    (p) => !guardedPaths.has(p),
  );
  if (violatingPaths.length > 0) {
    return {
      ok: false,
      error: `facts contains paths not in submitted tracked_files: ${violatingPaths.join(", ")}`,
      code: ErrorCode.VALIDATION_ERROR,
    };
  }
}
```

**Guard behaviour matrix:**

| Submitted `facts` | Submitted `tracked_files` | Result |
|---|---|---|
| omitted | any | pass — no guard needed |
| `{}` (empty) | any | pass — no paths to validate |
| `{ "a.ts": [...] }` | includes `"a.ts"` | pass |
| `{ "a.ts": [...] }` | does not include `"a.ts"` | `VALIDATION_ERROR` |
| `{ "a.ts": [...] }` | `[]` (empty) | `VALIDATION_ERROR` |

#### Step C — Facts per-path merge + eviction

Insert after `mergedTrackedFiles` is assembled, before `processedContent`.

Extract a module-level pure function `evictFactsForDeletedPaths`:

```typescript
function evictFactsForDeletedPaths(
  facts: Record<string, unknown>,
  survivingFiles: TrackedFile[],
): Record<string, unknown> {
  const survivingPaths = new Set(survivingFiles.map((f) => f.path));
  return Object.fromEntries(Object.entries(facts).filter(([path]) => survivingPaths.has(path)));
}
```

Then in the merge zone:

```typescript
// Per-path merge for facts (mirrors tracked_files merge)
const existingFactsRaw = existingContent["facts"];
const submittedFactsRaw = contentWithTimestamp["facts"];

const existingFacts =
  typeof existingFactsRaw === "object" && existingFactsRaw !== null && !Array.isArray(existingFactsRaw)
    ? (existingFactsRaw as Record<string, unknown>)
    : {};
const submittedFacts =
  typeof submittedFactsRaw === "object" && submittedFactsRaw !== null && !Array.isArray(submittedFactsRaw)
    ? (submittedFactsRaw as Record<string, unknown>)
    : {};

const rawMergedFacts = { ...existingFacts, ...submittedFacts };   // submitted paths win
const mergedFacts = evictFactsForDeletedPaths(rawMergedFacts, mergedTrackedFiles);
```

Finally, override `facts` in `processedContent` explicitly (to prevent `...contentWithTimestamp` spread from winning):

```typescript
const processedContent: Record<string, unknown> = {
  ...existingContent,
  ...contentWithTimestamp,
  tracked_files: mergedTrackedFiles,
  facts: mergedFacts,   // ← always set explicitly, overrides contentWithTimestamp spread
};
```

> **`global_facts` needs no special handling.** It is a regular top-level field. The existing `...contentWithTimestamp` overrides `...existingContent` pattern handles it correctly: agent submits it → it wins; agent omits it → existing value is preserved.

---

### 4.3 `skills/cache-ctrl-local/SKILL.md`

#### Update write input fields table

| Field | Type | Required | Notes |
|---|---|---|---|
| `topic` | `string` | ✅ | Human description of what was scanned |
| `description` | `string` | ✅ | One-liner for keyword search |
| `tracked_files` | `Array<{ path }>` | ✅ | Files read in this session; `mtime`/`hash` auto-computed |
| `global_facts` | `string[]` | optional | Repo-level facts; last-write-wins; see trigger rule below |
| `facts` | `Record<string, string[]>` | optional | Per-file facts keyed by path; per-path merge |
| `cache_miss_reason` | `string` | optional | Why the previous cache was discarded |

#### Add scope constraint section

```
### Scope rule for `facts`

Submit `facts` ONLY for files you actually read in this session (i.e., files present in
your submitted `tracked_files`). Never reconstruct or re-submit facts for unchanged files —
the tool preserves them automatically via per-path merge.

Submitting a facts key for a path absent from submitted `tracked_files` is a
VALIDATION_ERROR and the entire write is rejected.
```

#### Add `global_facts` trigger rule

```
### When to submit `global_facts`

Submit `global_facts` only when you re-read at least one structural file in this session:
AGENTS.md, install.sh, opencode.json, package.json, *.toml config files.

If none of those are in `changed_files` or `new_files`, omit `global_facts` from the write.
The existing value is preserved automatically.
```

#### Add eviction note

```
### Eviction

Facts for files deleted from disk are evicted automatically on the next write — no agent
action needed. `global_facts` is never evicted.
```

---

### 4.4 `deployable-agents/shared/subagents/local-context-gatherer.md`

Update **step 4** of the cache workflow:

```
4. Write:
   - tracked_files: [changed/new paths only]
   - facts: { "<path>": ["fact", ...] } for each file you read in this session
   - global_facts: [...] ONLY if a structural file (AGENTS.md, install.sh, opencode.json,
     package.json, *.toml) was in changed_files or new_files
   RULE: every key in facts must match a path in submitted tracked_files.
```

Update the **output section**:

```markdown
# Output (≤ 500 tokens)
- Cache hit/miss
- global_facts (repo-level context)
- Key facts per changed/new file
- Relevant files (non-exhaustive — reflects files known at last scan time)
- Constraints
- Unknowns
```

---

### 4.5 `tests/fixtures/local-sample.json`

```json
{
  "timestamp": "2026-01-01T00:00:00Z",
  "topic": "test local scan",
  "description": "A test local cache entry",
  "tracked_files": [
    { "path": "test-file.ts", "mtime": 1735689600000, "hash": "abc123def456" }
  ],
  "global_facts": ["test repo", "TypeScript project"],
  "facts": {
    "test-file.ts": ["exports a single function", "no side effects"]
  }
}
```

---

### 4.6 `tests/commands/write.test.ts` — new unit test cases

| # | Case | What it verifies |
|---|---|---|
| 1 | facts per-path merge: unsubmitted paths preserved | Paths not in submitted `tracked_files` survive in `facts` |
| 2 | facts per-path replace: submitted path overwrites existing | Submitted path's facts replace existing facts for that path |
| 3 | facts eviction: path deleted from disk | Evicted from `facts` after write when file no longer on disk |
| 4 | facts empty after all tracked files deleted | `facts` becomes `{}` when all tracked files are gone |
| 5 | scope guard — pass: facts paths ⊆ tracked_files | Write succeeds |
| 6 | scope guard — fail: facts has path not in tracked_files | Returns `VALIDATION_ERROR` before any disk write |
| 7 | scope guard — empty `facts: {}` | Always passes regardless of tracked_files |
| 8 | scope guard — `facts` key absent | Always passes |
| 9 | `global_facts` last-write-wins | Submitted value replaces existing |
| 10 | `global_facts` preserved when not submitted | Omitting `global_facts` preserves existing value |

---

### 4.7 `e2e/tests/write.e2e.test.ts` — new E2E scenarios

**Scenario 1 — Facts round-trip and delta preservation**

1. Write with `tracked_files=[A, B]` and `facts={ A: [...], B: [...] }`.
2. `inspect local context` → verify both fact entries present.
3. Write again with only `tracked_files=[A]` and `facts={ A: [new facts] }`.
4. `inspect local context` → verify `facts.A` updated, `facts.B` preserved from prior write.

**Scenario 2 — Scope guard rejection via CLI**

1. Write with `tracked_files=[A]` and `facts={ B: [...] }` (B not in tracked_files).
2. Expect: exit code `1`, stderr contains `VALIDATION_ERROR` and `"B"`.
3. Verify: no disk write occurred (file unchanged or still absent).

---

### 4.8 `README.md`

**Update**: Local cache schema section — add `global_facts` and `facts` with inline annotations matching the example in §2 above.

**Update**: `write` command description — add one bullet:

> - `local`: facts paths are validated against submitted `tracked_files` — submitting a facts key outside that set returns `VALIDATION_ERROR`.

---

## 5. Invariants

These must hold after implementation:

1. **Scope invariant**: a `facts` key can never be written for a path that was not in the same write's `tracked_files`.
2. **Preservation invariant**: facts for unchanged files (not submitted in a delta write) are preserved exactly, byte-for-byte.
3. **Eviction invariant**: after any write, no `facts` key exists for a path that is absent from `mergedTrackedFiles` (i.e., no longer on disk).
4. **Global durability**: `global_facts` is never modified by eviction logic; it can only change when the agent explicitly submits it.
5. **Backward compatibility**: `context.json` files without `global_facts` or `facts` fields are valid (both optional); first write with new code adds those fields.

---

## 6. What this does NOT solve

- **Cold-start recovery**: if `context.json` is deleted (via `flush`, `prune --delete`, or manually), all facts are lost. A cold-start rescan is required. This feature improves *delta durability*, not cold-start recovery.
- **Fact quality**: the schema accepts any `string[]`. Deduplication, quality, and consistency are the agent's responsibility — enforced by the skill, not by the tool.

# cache-ctrl CLI-First Migration Plan

## Overview

cache-ctrl currently ships two integration surfaces: a CLI (`src/index.ts`) and an
opencode plugin (`cache_ctrl.ts`). Both point at the same commands, but the plugin
adds ~5k non-cacheable tokens to every LLM API call via its JSON Schema tool
definitions.

This document specifies the work needed to make the CLI the **only** integration
surface. Skills replace tool schemas as the agent knowledge source. Zod validation
moves to the CLI boundary so agents get rich, self-correcting error responses via
`bash` stderr.

---

## Part 1 — Richer CLI error responses via Zod

### 1.1 Extend `CacheError` with structured issue fields

**File:** `src/types/result.ts`

Add two optional fields to `CacheError`:

```typescript
export interface CacheError {
  code: ErrorCode;
  error: string;
  issues?: ZodIssueSummary[];   // structured per-field problems
  hint?: string;                 // expected shape for self-correction
}

export interface ZodIssueSummary {
  path: string;       // dot-notation: "sources.0.url"
  message: string;    // human-readable from Zod
  code: string;       // Zod issue code: "invalid_type", "too_small", "invalid_value" …
  expected?: string;  // present for invalid_type
  received?: string;  // present for invalid_type
  values?: unknown[]; // present for invalid_value (enum)
  minimum?: number;   // present for too_small
}
```

`ZodIssueSummary` is a subset of what Zod 4 `ZodIssue` already carries — just
pick the relevant fields rather than leaking the full Zod type through the
public result.

### 1.2 Update `formatZodError` → `buildZodFailure`

**File:** `src/validation.ts`

Replace the current `formatZodError(error: ZodError): string` with a function that
returns a complete `CacheError` failure payload:

```typescript
export function buildZodFailure(
  error: ZodError,
  hint?: string,
): { ok: false; error: string; code: ErrorCode.VALIDATION_ERROR; issues: ZodIssueSummary[]; hint?: string }
```

- Use `z.prettifyError(error)` (Zod 4 built-in) for the `error` string — no custom
  path-joining needed.
- Map `error.issues` to `ZodIssueSummary[]`, picking only the fields listed in 1.1.
- Pass `hint` through when provided by the caller.

All current callers of `formatZodError` (`writeLocal.ts`, `writeExternal.ts`) switch
to `buildZodFailure`. Internal command validation stays in place as a safety net.

### 1.3 Validate `--data` payloads at the CLI dispatch boundary

**File:** `src/index.ts`

The `write-local` and `write-external` cases currently `JSON.parse` the `--data`
string and pass `Record<string, unknown>` straight to the command. Move Zod
validation up to the `switch` dispatch so errors are caught before reaching the
command:

```
write-local dispatch:
  1. JSON.parse --data  (existing, keep)
  2. WriteLocalInputSchema.safeParse(parsed)  ← new
     → failure: printError(buildZodFailure(error, WRITE_LOCAL_HINT)); exit(1)
     → success: writeLocalCommand({ agent: "local", content: parsed.data })

write-external dispatch:
  1. JSON.parse --data  (existing, keep)
  2. WriteExternalInputSchema.safeParse(parsed)  ← new
     → failure: printError(buildZodFailure(error, WRITE_EXTERNAL_HINT)); exit(1)
     → success: writeExternalCommand({ agent: "external", subject, content: parsed.data })
```

`WriteLocalInputSchema` and `WriteExternalInputSchema` are the same Zod schemas
already used inside the commands — extract them to `src/types/cache.ts` and
reference them from both the CLI dispatch and the command internals.

### 1.4 Static hint constants per command

**File:** `src/index.ts` (or a `src/hints.ts` constant module)

Two constants, inlined into the `buildZodFailure` call at the dispatch site:

```typescript
const WRITE_LOCAL_HINT =
  "Required: topic (string), description (string), " +
  "tracked_files (array of {path: string}). " +
  "Optional: global_facts (string[] ≤20 items, each ≤300 chars), " +
  "facts (Record<path, {summary?, role?: entry-point|interface|implementation|test|config, " +
  "importance?: 1|2|3, facts?: string[]}>), cache_miss_reason (string)";

const WRITE_EXTERNAL_HINT =
  "Required: description (string), " +
  'fetched_at (ISO 8601 UTC e.g. "2026-04-14T12:00:00.000Z"), ' +
  "sources (array of {type: string, url: string, version?: string})";
```

### 1.5 Per-field `.error()` callbacks for tricky fields

**File:** `src/types/cache.ts`

For `fetched_at`, which requires a specific datetime format, use Zod 4's `error`
callback so the hint appears in the issue message itself — no static constant needed
for this one:

```typescript
fetched_at: z.string().datetime({
  error: (issue) =>
    issue.input === undefined
      ? 'fetched_at is required — ISO 8601 UTC e.g. "2026-04-14T12:00:00.000Z"'
      : `fetched_at must be ISO 8601 UTC e.g. "2026-04-14T12:00:00.000Z", got: ${String(issue.input)}`,
}),
```

Apply the same pattern to any enum field whose valid options are not obvious
(e.g. `role` in `FileFactsSchema`).

### 1.6 What the resulting stderr looks like

An agent passing a wrong `fetched_at` will receive on stderr:

```json
{
  "ok": false,
  "code": "VALIDATION_ERROR",
  "error": "✖ fetched_at must be ISO 8601 UTC e.g. \"2026-04-14T12:00:00.000Z\", got: yesterday\n  → at fetched_at",
  "issues": [
    {
      "path": "fetched_at",
      "message": "fetched_at must be ISO 8601 UTC e.g. \"2026-04-14T12:00:00.000Z\", got: yesterday",
      "code": "invalid_string",
      "received": "yesterday"
    }
  ],
  "hint": "Required: description (string), fetched_at (ISO 8601 UTC e.g. \"2026-04-14T12:00:00.000Z\"), sources (array of {type: string, url: string, version?: string})"
}
```

The `error` string (from `z.prettifyError`), the `issues` array, and the `hint`
together give the agent everything it needs to self-correct in one attempt.

---

## Part 2 — Rewrite skills as CLI references

All three skills currently reference tool names (`cache_ctrl_check_files`,
`cache_ctrl_write_local`, etc.). Every occurrence becomes a `bash` invocation
with the equivalent CLI command.

### 2.1 Naming mapping

| Current tool name | CLI equivalent |
|---|---|
| `cache_ctrl_check_files` | `cache-ctrl check-files` |
| `cache_ctrl_list` (agent: "external") | `cache-ctrl list --agent external` |
| `cache_ctrl_search` | `cache-ctrl search <kw> [<kw>…]` |
| `cache_ctrl_inspect_external` | `cache-ctrl inspect-external <subject>` |
| `cache_ctrl_inspect_local` | `cache-ctrl inspect-local [--filter <kw>] [--folder <path>] [--search-facts <kw>]` |
| `cache_ctrl_write_local` | `cache-ctrl write-local --data '<json>'` |
| `cache_ctrl_write_external` | `cache-ctrl write-external <subject> --data '<json>'` |
| `cache_ctrl_invalidate` (local) | `cache-ctrl invalidate local [<subject-kw>]` |
| `cache_ctrl_invalidate` (external) | `cache-ctrl invalidate external [<subject-kw>]` |
| `cache_ctrl_map` | `cache-ctrl map [--depth overview\|modules\|full] [--folder <path>]` |
| `cache_ctrl_graph` | `cache-ctrl graph [--max-tokens <n>] [--seed <path>]` |

### 2.2 `skills/cache-ctrl-caller/SKILL.md`

**Remove:**
- All `cache_ctrl_*` tool call syntax.
- The "Anti-Bloat Rules" section mentioning tool spawning semantics.
- The `server_time` section (tool-specific).

**Rewrite:**
- Every decision table entry replaces the tool name with the full CLI invocation
  inside a bash code block.
- The Quick Reference table becomes a CLI cheatsheet.

```markdown
## Quick Reference

| Operation | Command |
|---|---|
| Check local freshness | `cache-ctrl check-files` |
| List external entries | `cache-ctrl list --agent external` |
| Search cache entries | `cache-ctrl search <kw> [<kw>…]` |
| Read facts (filtered) | `cache-ctrl inspect-local --filter <kw>` |
| Read external entry | `cache-ctrl inspect-external <subject>` |
| Codebase map | `cache-ctrl map [--depth overview\|modules\|full]` |
| Dependency graph | `cache-ctrl graph [--max-tokens <n>]` |
| Invalidate local | `cache-ctrl invalidate local` |
| Invalidate external | `cache-ctrl invalidate external <subject-kw>` |
```

**Keep:** All decision logic (when to call gatherers, navigation-first rules,
inspect targeting guidance, security note on untrusted content).

### 2.3 `skills/cache-ctrl-local/SKILL.md`

**Remove:**
- `cache_ctrl_write_local` tool reference syntax and the auto-set fields note
  (`timestamp`, `mtime`, `hash`).
- The Tool Reference table at the bottom.

**Rewrite the Scan Workflow section** to use CLI:

```markdown
## Scan Workflow

1. Run `cache-ctrl check-files` to identify changed and new files.
2. Read only the changed/new files (skip unchanged ones).
3. Extract `FileFacts` per file (follow Fact-Writing Rules above).
4. Run `cache-ctrl write-local --data '<json>'` — **mandatory** (see Write-Before-Return Rule).
5. Return your summary.
```

**Rewrite the write reference section** to show the CLI `--data` payload shape and
a full example with the actual command:

```bash
cache-ctrl write-local --data '{
  "topic": "src/commands scan",
  "description": "Scan of src/commands after write refactor",
  "tracked_files": [{ "path": "src/commands/writeLocal.ts" }],
  "facts": {
    "src/commands/writeLocal.ts": {
      "summary": "Validates and writes local cache entries with merge semantics.",
      "role": "implementation",
      "importance": 2
    }
  }
}'
```

**Add a CLI Quick Reference** at the bottom:

```markdown
## Quick Reference

| Operation | Command |
|---|---|
| Detect file changes | `cache-ctrl check-files` |
| Write cache | `cache-ctrl write-local --data '<json>'` |
| Read facts (filtered) | `cache-ctrl inspect-local --filter <kw>` |
| Invalidate cache | `cache-ctrl invalidate local` |
| Confirm written | `cache-ctrl list --agent local` |
```

### 2.4 `skills/cache-ctrl-external/SKILL.md`

**Remove:**
- `cache_ctrl_write_external` tool reference syntax.
- The Tool Reference table.

**Rewrite the write section** to use the CLI:

```bash
cache-ctrl write-external <subject> --data '{
  "description": "<one-line summary>",
  "fetched_at": "<ISO 8601 UTC now>",
  "sources": [{ "type": "<type>", "url": "<canonical-url>" }]
}'
```

Note: the `subject` is now a positional CLI argument, not a field inside `--data`.

**Add a CLI Quick Reference:**

```markdown
## Quick Reference

| Operation | Command |
|---|---|
| List all entries | `cache-ctrl list --agent external` |
| Search entries | `cache-ctrl search <kw> [<kw>…]` |
| Read full entry | `cache-ctrl inspect-external <subject>` |
| Write entry | `cache-ctrl write-external <subject> --data '<json>'` |
| Invalidate entry | `cache-ctrl invalidate external <subject-kw>` |
```

---

## Part 3 — Remove tool infrastructure

### 3.1 Files to delete entirely

| File | Reason |
|---|---|
| `cache_ctrl.ts` | Plugin tool definitions — the entire surface being removed |
| `src/files/openCodeInstaller.ts` | Generates tool wrapper; copies skills (skills copy moves to simplified installer) |
| `src/commands/install.ts` | Wraps `installOpenCodeIntegration` which is being deleted |
| `src/commands/update.ts` | Calls `installCommand` after npm update; tool-specific logic |
| `src/commands/uninstall.ts` | Removes tool wrapper and npm package |
| `src/commands/configDir.ts` | Only consumed by install/update/uninstall config-dir validation |
| `tests/commands/install.test.ts` | Tests for deleted command |
| `tests/commands/update.test.ts` | Tests for deleted command |
| `tests/commands/uninstall.test.ts` | Tests for deleted command |
| `.opencode/package.json` | Only present to provide `@opencode-ai/plugin` for the plugin surface |
| `.opencode/package-lock.json` | Lockfile for the above |

### 3.2 Files to modify

**`package.json`**
- Remove `@opencode-ai/plugin` from `dependencies`.
- Remove `cache_ctrl.ts` from `files` array.

**`src/types/commands.ts`**
- Remove `InstallArgs`, `InstallResult`, `UpdateArgs`, `UpdateResult`,
  `UninstallArgs`, `UninstallResult` interfaces and their JSDoc sections.

**`src/index.ts`**
- Remove imports: `installCommand`, `updateCommand`, `uninstallCommand`.
- Remove `install`, `update`, `uninstall` from the `CommandName` union.
- Remove the three `case` blocks and their `COMMAND_HELP` entries.
- Remove `runConfigDirCommand` helper (only used by those three cases).

**`install.sh`**
- Remove the tool-wrapper copy step (`~/.config/opencode/tools/cache_ctrl.ts`).
- Keep only the skill copy steps, or replace the whole script with a note pointing
  to `cache-ctrl install`.

### 3.3 Simplify the `install` command

The `install` command retains value for distributing skills to
`~/.config/opencode/skills/`. Strip it to skills-only:

**`src/files/openCodeInstaller.ts` → `src/files/skillsInstaller.ts`**
- Delete `buildToolWrapperContent`.
- Delete the `toolDir` / `toolPath` / `writeFile` block.
- Return only `{ skillPaths, configDir }` — no `toolPath`.

**`src/types/commands.ts`**

```typescript
export interface InstallResult {
  skillPaths: string[];
  configDir: string;
}
```

**`src/commands/install.ts`** — keep, but point at the new `skillsInstaller`.

This preserves the user-facing `cache-ctrl install` command as the mechanism for
deploying skill files, without any tool infrastructure.

---

## Summary — file-by-file change table

| File | Action | Notes |
|---|---|---|
| `cache_ctrl.ts` | **Delete** | Plugin surface removed |
| `src/types/result.ts` | **Modify** | Add `issues?`, `hint?` to `CacheError`; add `ZodIssueSummary` type |
| `src/types/commands.ts` | **Modify** | Remove install/update/uninstall types; slim `InstallResult` |
| `src/types/cache.ts` | **Modify** | Add `.error()` callbacks to `fetched_at`, `role`; extract `WriteLocalInputSchema` / `WriteExternalInputSchema` |
| `src/validation.ts` | **Modify** | Replace `formatZodError` with `buildZodFailure`; use `z.prettifyError` |
| `src/index.ts` | **Modify** | Validate `--data` at dispatch; remove install/update/uninstall cases |
| `src/commands/writeLocal.ts` | **Modify** | Switch to `buildZodFailure`; trust pre-validated input from CLI |
| `src/commands/writeExternal.ts` | **Modify** | Switch to `buildZodFailure`; trust pre-validated input from CLI |
| `src/commands/install.ts` | **Modify** | Point at new skills-only installer |
| `src/commands/update.ts` | **Delete** | |
| `src/commands/uninstall.ts` | **Delete** | |
| `src/commands/configDir.ts` | **Delete** | |
| `src/files/openCodeInstaller.ts` | **Delete** | Replaced by `skillsInstaller.ts` |
| `src/files/skillsInstaller.ts` | **Create** | Skills-only installer, no tool wrapper |
| `skills/cache-ctrl-caller/SKILL.md` | **Rewrite** | Tool names → CLI commands; remove `server_time` section |
| `skills/cache-ctrl-local/SKILL.md` | **Rewrite** | Tool names → CLI commands; add full bash example |
| `skills/cache-ctrl-external/SKILL.md` | **Rewrite** | Tool names → CLI commands; clarify subject as positional arg |
| `package.json` | **Modify** | Remove `@opencode-ai/plugin`; remove `cache_ctrl.ts` from `files` |
| `.opencode/package.json` | **Delete** | |
| `.opencode/package-lock.json` | **Delete** | |
| `install.sh` | **Modify** | Remove tool-wrapper copy step |
| `tests/commands/install.test.ts` | **Modify** | Remove tool-path assertions; test skills-only output |
| `tests/commands/update.test.ts` | **Delete** | |
| `tests/commands/uninstall.test.ts` | **Delete** | |

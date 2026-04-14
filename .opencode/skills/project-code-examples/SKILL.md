---
name: project-code-examples
description: Catalog of project code examples — what patterns exist and where to find them in .code-examples-for-ai/
---

# Project Code Examples Catalog

All example files live in `.code-examples-for-ai/` at the repo root. Each file documents one concrete pattern extracted from the actual source code. Read the relevant file(s) before implementing a feature that uses the pattern.

---

## Index

| File | Pattern | Key Source File |
|---|---|---|
| `result-pattern.md` | `Result<T, E>` discriminated union — typed error returns without throwing | `src/types/result.ts` |
| `zod-schema-validation.md` | Zod `safeParse()` at boundaries plus structured `buildZodFailure` payloads for CLI self-correction | `src/types/cache.ts`, `src/validation.ts`, `src/index.ts` |
| `command-handler.md` | Command handler structure — async function, typed Args, delegate I/O to services | `src/commands/list.ts`, `src/index.ts` |
| `error-handling.md` | Canonical catch-all conversion in command handlers via `toUnknownResult(err)` | `src/errors.ts`, `src/commands/list.ts`, `src/commands/writeLocal.ts` |
| `change-detector.md` | Async file comparison — `Promise.all` parallelism, mtime/hash fallback, path traversal guard | `src/files/changeDetector.ts` |
| `subject-validation.md` | Subject string validation — regex + max-length guard that becomes a file path component | `src/validation.ts` |
| `personalized-pagerank.md` | Personalized PageRank ranking over dependency graphs with dangling-node redistribution | `src/analysis/pageRank.ts` |
| `watch-daemon-command.md` | Long-running Bun watcher command with debounce, serialized rebuilds, and signal shutdown | `src/commands/watch.ts` |

---

## When to Add a New Example

Create or update an example file when you implement a pattern that is:

1. **Novel to this codebase** — not yet represented in the catalog above
2. **Reusable** — likely to appear in future features
3. **Non-obvious** — the why or how needs a brief explanation

Keep each example:
- One pattern per file
- A one-line description comment at the top
- Real code snippets from actual project files (not invented examples)
- Brief inline comments explaining what to imitate

After adding a new example file, add a row to the index table in this SKILL.md.

---

## Patterns NOT Yet Covered (candidates for future examples)

- Advisory file locking (`acquireLock` / `releaseLock`) — `src/cache/cacheManager.ts`
- Atomic write via temp file + rename — `src/cache/cacheManager.ts`
- Keyword scoring / search ranking — `src/search/keywordSearch.ts`
- HTTP HEAD freshness check — `src/http/`
- E2E test structure with Docker — `e2e/tests/`

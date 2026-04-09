# AGENTS.md

This repository uses a multi-agent coding system. All implementer agents must follow the project skills defined in `.opencode/skills/`.

## Skills

| Skill | Location | Purpose |
|---|---|---|
| `project-coding` | `.opencode/skills/project-coding/SKILL.md` | Coding conventions, naming, architecture patterns, error handling |
| `project-build` | `.opencode/skills/project-build/SKILL.md` | Build commands, prerequisites, environment setup |
| `project-test` | `.opencode/skills/project-test/SKILL.md` | Test framework, conventions, patterns, coverage |
| `project-documentation` | `.opencode/skills/project-documentation/SKILL.md` | TSDoc, README standards, API docs |
| `project-security` | `.opencode/skills/project-security/SKILL.md` | Input validation, path traversal, dependency security |
| `project-code-examples` | `.opencode/skills/project-code-examples/SKILL.md` | Catalog of reusable code patterns |

## Code Examples

Concrete, annotated snippets extracted from the real codebase live in `.code-examples-for-ai/`. Read these before implementing a feature that uses one of the documented patterns.

## Stack

- **Runtime**: Bun 1.x (TypeScript executed natively — no build step)
- **Language**: TypeScript strict mode (ESNext, verbatimModuleSyntax, noUncheckedIndexedAccess, exactOptionalPropertyTypes)
- **Schema validation**: Zod 4.x
- **Test framework**: Vitest 4.x (unit in `tests/`, E2E in `e2e/` via Docker)
- **Architecture**: CLI command layer (`src/commands/`) + core services (`src/cache/`, `src/files/`, `src/http/`, `src/search/`)

## Key Rules

- All recoverable errors use `Result<T, E>` — never throw across command boundaries
- All external JSON is validated with Zod `safeParse()` before use
- All subject strings and tracked file paths are validated against traversal guards before filesystem use
- Tests must cover happy path + every `ErrorCode` branch per command
- No TODOs, placeholder logic, or commented-out dead code in production paths

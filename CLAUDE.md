# CLAUDE.md

## Project Coding Guidelines

All coding conventions, architecture patterns, build commands, test requirements, documentation standards, and security rules are documented in `.opencode/skills/`.

| Skill | What it covers |
|---|---|
| `.opencode/skills/project-coding/SKILL.md` | Code style, naming, imports, error handling, architecture |
| `.opencode/skills/project-build/SKILL.md` | Build commands, environment setup (`bun install`, `bunx tsc --noEmit`) |
| `.opencode/skills/project-test/SKILL.md` | Vitest conventions, test location, mocking, coverage |
| `.opencode/skills/project-documentation/SKILL.md` | TSDoc, README format, changelog |
| `.opencode/skills/project-security/SKILL.md` | Path traversal, Zod validation, advisory locking |
| `.opencode/skills/project-code-examples/SKILL.md` | Index of reusable code patterns in `.code-examples-for-ai/` |

## Quick Reference

- **Run tests**: `bun run test`
- **Type check**: `bunx tsc --noEmit`
- **E2E tests**: `bun run test:e2e` (requires Docker)
- **No build step** — Bun runs TypeScript files directly

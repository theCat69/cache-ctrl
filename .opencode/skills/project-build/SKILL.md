---
name: project-build
description: Project-specific build commands, prerequisites, environment setup, and CI/CD pipeline
---

# Project Build Guide

`cache-ctrl` is a TypeScript CLI that runs **directly via Bun** — there is no separate compilation step. Bun executes `.ts` files natively. The `noEmit: true` setting in `tsconfig.json` confirms that `tsc` is used for type checking only.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Bun | 1.x | Primary runtime and package manager |
| Node.js | Not required | Bun is the sole runtime |
| Docker | For E2E tests | `docker compose` must be available |
| Git | For repo root detection | `findRepoRoot()` walks up looking for `.git` |

Install Bun: `curl -fsSL https://bun.sh/install | bash`

---

## Environment Setup

```bash
# Install dependencies
bun install

# Verify TypeScript types (type-check only, no emit)
bunx tsc --noEmit
```

No `.env` file is required for local development. The tool anchors itself to the repo root via `findRepoRoot(process.cwd())` which walks up the directory tree until it finds a `.git` directory.

---

## Build Commands

There is **no explicit build step**. Bun runs TypeScript files directly via the shebang entry point:

```bash
# Run the CLI directly
bun run cache_ctrl.ts <command> [args]

# Or via the installed binary (after install.sh)
cache-ctrl <command> [args]
```

### Type Checking (CI equivalent of "build")

```bash
bunx tsc --noEmit
```

This validates the entire codebase (`src/`, `cache_ctrl.ts`, `tests/`, `e2e/`) with full strict settings. Treat type-check failures as build failures.

### Installation

**End-user (recommended):**

```bash
npm install -g @thecat69/cache-ctrl
cache-ctrl install          # configures OpenCode integration
```

**Local development (from source):**

```bash
bash install.sh
```

`install.sh` creates symlinks for local development only. For end-user distribution, use `npm install -g @thecat69/cache-ctrl`. `cache-ctrl install` writes the OpenCode tool wrapper and copies skill files into the OpenCode config directory.

---

## Development Server

This is a CLI tool — there is no dev server. For interactive development:

```bash
# Run any command directly
bun run cache_ctrl.ts list
bun run cache_ctrl.ts check-files
bun run cache_ctrl.ts inspect external vitest

# Start the watch daemon (long-running; builds and maintains graph.json)
cache-ctrl watch --verbose
# Or run directly from source:
bun run src/index.ts watch --verbose

# Watch-mode type checking (if needed)
bunx tsc --noEmit --watch
```

---

## CI/CD Pipeline

**No CI/CD configuration exists in this repository.**

When adding CI (GitHub Actions, GitLab CI, etc.), the pipeline should run:

```yaml
# Recommended pipeline steps
steps:
  - bun install --frozen-lockfile
  - bunx tsc --noEmit                         # Type checking
  - bun run test                               # Unit tests (vitest)
  - bun run test:e2e                           # E2E tests (Docker)
```

### Key Test Commands

| Command | Description |
|---|---|
| `bun run test` | Run all unit tests once (vitest run) |
| `bun run test:watch` | Run unit tests in watch mode |
| `bun run test:e2e` | Run E2E tests via Docker Compose |

### Docker E2E Context

```bash
# E2E tests use:
docker compose -f e2e/docker-compose.yml run --rm e2e
```

The E2E suite runs the compiled CLI inside a Docker container to validate real filesystem and cache interactions. Ensure Docker daemon is running before executing `test:e2e`.

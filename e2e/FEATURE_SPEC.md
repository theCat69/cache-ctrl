# Feature Specification: Docker-Based E2E Test Harness for `cache-ctrl`

**Project**: `cache-ctrl` CLI (TypeScript/Bun)  
**Location**: `.config/opencode/custom-tool/cache-ctrl/e2e/`  
**Author**: PM/Tech Lead  
**Date**: 2026-04-06  
**Status**: Revised (v3) — ready for final review

---

## 1. Overview

### Problem

The existing test suite uses vitest with unit tests that call command functions directly via `process.chdir()`. This validates logic in isolation but does **not** verify the CLI as an end-to-end invocable program. Bugs in argument parsing, exit-code handling, stdout/stderr routing, JSON output formatting, and cross-command interactions are invisible to unit tests.

### Solution

A Docker-based E2E harness that:
1. Spawns the actual CLI binary (`bun /app/src/index.ts`) as a subprocess for every test assertion.
2. Runs inside a reproducible Docker container with `git` installed (required for `check-files` integration).
3. Uses a baked fixture repo template that each test copies to an isolated temp directory.
4. Requires zero host dependencies beyond Docker — `docker compose run e2e` is the single entry point.

### Why Docker

- Eliminates "works on my machine" drift — `git` version, locale, filesystem behavior, and `bun` version are pinned in the image.
- Prevents subprocess tests from mutating the developer's actual dotfiles repo.
- The bind-mount strategy keeps source hot-reloadable without rebuilding the image on every code change.

### Scope boundary

E2E tests validate **CLI contract** (exit codes, stdout JSON shape, stderr messages). They do **not** re-validate internal logic already covered by unit tests. Coverage is not collected for e2e tests.

---

## 2. Complete File Tree

All files to be created (relative to `cache-ctrl/`):

```
.dockerignore       ← at cache-ctrl/ root (build context root)
e2e/
├── Dockerfile
├── docker-compose.yml
├── vitest.config.ts
├── fixtures/
│   └── repo/
│       ├── .gitignore
│       ├── src/
│       │   ├── file-a.ts
│       │   └── file-b.ts
│       └── .ai/
│           ├── external-context-gatherer_cache/
│           │   └── sample-external.json
│           └── local-context-gatherer_cache/
│               └── context.json
├── helpers/
│   ├── cli.ts
│   └── repo.ts
└── tests/
    ├── smoke.e2e.test.ts
    ├── list.e2e.test.ts
    ├── inspect.e2e.test.ts
    ├── write.e2e.test.ts
    ├── write-perf.e2e.test.ts
    ├── check-files.e2e.test.ts
    ├── invalidate.e2e.test.ts
    ├── flush.e2e.test.ts
    ├── search.e2e.test.ts
    ├── touch.e2e.test.ts
    ├── prune.e2e.test.ts
    └── help.e2e.test.ts
```

Additionally, `package.json` at the `cache-ctrl/` root gains one new script entry.

---

## 3. Feature Specifications

---

### Feature 1: Docker Infrastructure

#### 3.1 `e2e/Dockerfile`

**Purpose**: Build a reproducible environment containing `bun`, `git`, and the baked fixture repo template. Source code is NOT copied — it is bind-mounted at runtime.

**File path**: `e2e/Dockerfile`

**Full specification**:

```dockerfile
FROM oven/bun:latest

# Install git (for check-files git integration) and ca-certificates (for HTTPS in check-freshness)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

# Configure a global git identity so git commits work without a home directory
RUN git config --global user.email "e2e@cache-ctrl.test" && \
    git config --global user.name "E2E Test Runner"

# Bake the fixture repo template into the image
# BUILD CONTEXT is the cache-ctrl/ directory (see docker-compose.yml)
COPY e2e/fixtures/repo /fixtures/repo-template

# Initialize git inside the template so copied temp dirs are standalone git repos
RUN git -C /fixtures/repo-template init && \
    git -C /fixtures/repo-template add . && \
    git -C /fixtures/repo-template commit -m "init: fixture"

# NOTE: .ai/ is present on disk inside the template but is excluded from .gitignore,
# so it will NOT be committed to the fixture git repo. It is available on the filesystem
# because it was COPY-ed in the previous step. This is intentional — the fixture template
# has both a git repo (one commit tracking src/ files) AND a pre-populated .ai/ cache dir.
# The two are independent: git does not track the cache, but both exist on disk.

WORKDIR /app

# source bind-mounted at runtime via docker-compose.yml volumes
# install deps and run e2e tests
CMD ["sh", "-c", "bun install && bunx vitest run --config e2e/vitest.config.ts"]
```

**Design constraints**:
- `FROM oven/bun:latest` — no version pinning per project policy.
- `git config --global` must run as the same user that will execute tests. In `oven/bun:latest` the default user is `bun`. If `RUN` runs as root (default in Docker), the global config will be in `/root/.gitconfig`. The CMD spawns processes as `bun`, so the `--global` config will not be found. To fix: run the CMD as root (no `USER bun` directive) **or** set `GIT_CONFIG_GLOBAL=/fixtures/.gitconfig` environment variable. **Recommended**: set env var `GIT_CONFIG_GLOBAL=/fixtures/.gitconfig` and write the config to that path, ensuring both root and non-root users pick it up.
- Actually simpler: use `git init -c user.email=... -c user.name=...` inline in the `RUN` step, and set `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` as `ENV` in the Dockerfile so all subprocess git calls in tests pick them up automatically without a `.gitconfig` file.

**Revised approach for git identity** (preferred over `git config --global`):

```dockerfile
ENV GIT_AUTHOR_NAME="E2E Test Runner"
ENV GIT_AUTHOR_EMAIL="e2e@cache-ctrl.test"
ENV GIT_COMMITTER_NAME="E2E Test Runner"
ENV GIT_COMMITTER_EMAIL="e2e@cache-ctrl.test"
```

Then the fixture init step becomes:

```dockerfile
RUN git -C /fixtures/repo-template init && \
    git -C /fixtures/repo-template add . && \
    GIT_AUTHOR_NAME="E2E" GIT_AUTHOR_EMAIL="e2e@test" \
    GIT_COMMITTER_NAME="E2E" GIT_COMMITTER_EMAIL="e2e@test" \
    git -C /fixtures/repo-template commit -m "init: fixture"
```

Since the ENV vars are set later, inline overrides are needed for the RUN step itself. The `ENV` block covers all subprocess git calls made during test execution.

---

#### 3.2 `e2e/docker-compose.yml`

**Purpose**: Declare the `e2e` service that builds the image and runs tests. The build context is the entire `cache-ctrl/` directory so the `COPY e2e/fixtures/repo` path is valid.

**File path**: `e2e/docker-compose.yml`

**Full specification**:

```yaml
services:
  e2e:
    build:
      context: .
      dockerfile: e2e/Dockerfile
    volumes:
      - .:/app
    working_dir: /app
```

**Design constraints**:
- `context: .` — build context is `cache-ctrl/` (the directory that contains `e2e/`, `src/`, `package.json`, etc.). This is required for the `COPY e2e/fixtures/repo` directive in the Dockerfile to resolve correctly.
- `dockerfile: e2e/Dockerfile` — relative to build context, i.e. `cache-ctrl/e2e/Dockerfile`.
- `volumes: - .:/app` — bind-mounts the entire `cache-ctrl/` directory to `/app`. Source changes are visible immediately; no image rebuild needed between code edits.
- No port mapping — tests are purely local subprocess calls.
- No `restart` policy — the container exits when tests complete.
- The `node_modules/` directory will be created inside `/app` by `bun install` at container start. Since `/app` is bind-mounted, `node_modules/` will appear in the host `cache-ctrl/` directory too. This is expected and acceptable (matches the existing dev workflow).

---

#### 3.1b `cache-ctrl/.dockerignore`

**Purpose**: Prevents Docker build context from including large/irrelevant directories. The build context is the entire `cache-ctrl/` directory, so without this file, `node_modules/` and other large directories would be sent to the Docker daemon unnecessarily. This file sits at the build context root (`cache-ctrl/`), which is the standard and reliable location for Docker to resolve it.

**File path**: `cache-ctrl/.dockerignore` (build context root, not `e2e/.dockerignore`)

**Full specification**:

```
node_modules/
.ai/
e2e/tests/
e2e/helpers/
```

**Design constraints**:
- `node_modules/` — excluded because they're installed inside the container by `bun install`.
- `.ai/` — excluded because cache state is runtime data, not build-time data.
- `e2e/tests/` and `e2e/helpers/` — excluded because they are bind-mounted at `/app`, not COPYed. The Dockerfile only COPYs `e2e/fixtures/repo`.
- **Placement**: Standard Docker resolves `.dockerignore` from the build context root, which is `cache-ctrl/` (as specified by `context: .` in docker-compose.yml). The file must therefore be placed at `cache-ctrl/.dockerignore`. Co-locating it at `e2e/.dockerignore` (next to the Dockerfile) is only honored when BuildKit is enabled (`DOCKER_BUILDKIT=1`) — this is non-default and must not be relied on. If an organization uses BuildKit by default, `e2e/.dockerignore` will also work, but `cache-ctrl/.dockerignore` is always the safe choice.

---

### Feature 2: Vitest E2E Config

#### 3.3 `e2e/vitest.config.ts`

**Purpose**: Separate vitest configuration for E2E tests. Must not interfere with the existing unit test config (which uses the default vitest config with no explicit config file).

**File path**: `e2e/vitest.config.ts`

**Full specification**:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["e2e/tests/**/*.e2e.test.ts"],
    testTimeout: 30_000,
    pool: "forks",
    coverage: {
      enabled: false,
    },
  },
});
```

**Design constraints**:
- `include` pattern: `e2e/tests/**/*.e2e.test.ts` — the `.e2e.test.ts` suffix distinguishes e2e tests from unit tests and prevents accidental inclusion in the default `vitest run` (which uses the root config and includes `tests/**`).
- `testTimeout: 30_000` — CLI subprocess spawn can take several seconds; 30s is a safe upper bound. Individual test authors must not increase this without a documented reason.
- `pool: "forks"` — required for process-level isolation. `threads` pool shares memory and can cause cwd/env contamination across test files. `forks` ensures each test file runs in its own OS process.
- `coverage.enabled: false` — E2E tests exercise the CLI as a black box; coverage collection would be meaningless and slow.
- The path `e2e/vitest.config.ts` is passed to vitest via the CMD in the Dockerfile: `bunx vitest run --config e2e/vitest.config.ts`.

---

### Feature 3: Fixture Repo Template

#### 3.4 `e2e/fixtures/repo/` — directory structure

**Purpose**: A self-contained project directory baked into the Docker image at `/fixtures/repo-template`. Each test copies this to a fresh temp dir. The fixture contains pre-populated `.ai/` cache entries AND real source files tracked by git.

**Key design invariant**: The `.gitignore` must list `.ai/` so the cache directories are not tracked by git. But since the fixture is `COPY`-ed into the Docker image before `git init` runs, the `.ai/` directory *exists on disk* even though git does not track it. Tests that need a clean cache can `rm -rf .ai/` after copying; tests that need a pre-populated cache use it as-is.

---

##### 3.4.1 `e2e/fixtures/repo/.gitignore`

```
.ai/
node_modules/
```

**Notes**: Two lines, no trailing space. The `.ai/` directory will not be staged by `git add .` during the fixture init step in the Dockerfile, meaning it won't appear in the initial git commit but will still be present on disk for tests to use. `node_modules/` must be excluded because `bun install` (run at container start) bind-mounts `node_modules` back into the host `/app` directory — without this entry, `git status` inside the fixture repo would report `node_modules/` as untracked files, breaking `check-files` output.

---

##### 3.4.2 `e2e/fixtures/repo/src/file-a.ts`

```typescript
export const fileA = "fixture-a";
```

**Notes**: Tracked by git (committed in the fixture's initial commit). Used by `check-files` tests to verify changed/unchanged detection.

---

##### 3.4.3 `e2e/fixtures/repo/src/file-b.ts`

```typescript
export const fileB = "fixture-b";
```

**Notes**: Tracked by git. Used alongside `file-a.ts` in `check-files` tests.

---

##### 3.4.4 `e2e/fixtures/repo/.ai/external-context-gatherer_cache/sample-external.json`

```json
{
  "subject": "sample",
  "description": "A sample external cache entry for e2e testing",
  "fetched_at": "2026-01-01T00:00:00Z",
  "sources": [
    { "type": "docs", "url": "https://example.com/sample-docs" }
  ],
  "header_metadata": {
    "https://example.com/sample-docs": {
      "etag": "\"sample-etag-abc123\"",
      "checked_at": "2026-01-01T01:00:00Z",
      "status": "fresh"
    }
  }
}
```

**Notes**:
- `subject: "sample"` — the filename stem matches the subject field. Required by the CLI's naming convention.
- `fetched_at: "2026-01-01T00:00:00Z"` — deliberately old (stale after 24h). Tests that need a fresh entry must either `touch` it or write a new one. Tests that need a stale entry can use this as-is.
- The `sources` array and `header_metadata` object are non-empty to enable realistic `inspect` and `check-freshness` assertions.

---

##### 3.4.5 `e2e/fixtures/repo/.ai/local-context-gatherer_cache/context.json`

```json
{
  "timestamp": "2026-01-01T00:00:00Z",
  "topic": "fixture local scan",
  "description": "Pre-populated local cache for e2e fixture",
  "tracked_files": [
    { "path": "src/file-a.ts", "mtime": 1735689600000, "hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    { "path": "src/file-b.ts", "mtime": 1735689600000, "hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
  ]
}
```

**Notes**:
- `timestamp: "2026-01-01T00:00:00Z"` — stale (older than 1h).
- `mtime: 1735689600000` — a placeholder epoch value (2026-01-01 UTC). When the fixture is `cp -r`-ed, the copied files will have a current mtime, so `check-files` will **always report these as changed** unless a test explicitly overwrites the cache with correct mtimes.
- `hash` values are 64 'a' and 'b' characters — valid length for SHA-256 hex output but intentionally wrong content hashes. This ensures `check-files` reports `reason: "hash"` on these entries.
- This predictable behavior is intentional: tests that need `status: "changed"` use the fixture as-is; tests that need `status: "unchanged"` must call `write local` with the real mtime/hash after copying.

---

### Feature 4: Test Helpers

#### 3.5 `e2e/helpers/cli.ts`

**Purpose**: Typed wrapper around `Bun.spawn` for invoking the CLI as a subprocess. Provides clean `CliResult` typing and a JSON parse helper.

**File path**: `e2e/helpers/cli.ts`

**Full specification**:

```typescript
/**
 * Result of a CLI subprocess invocation.
 * stdout and stderr are the complete raw text output.
 * exitCode mirrors the process exit code (0, 1, or 2).
 */
export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Spawns: bun /app/src/index.ts ...args
 *
 * @param args  - CLI arguments (e.g. ["list", "--agent", "external"])
 * @param options.cwd - Working directory for the subprocess. Defaults to process.cwd().
 *
 * The function always resolves (never rejects) — exit code non-zero is NOT an exception.
 * Callers must check result.exitCode themselves.
 */
export async function runCli(
  args: string[],
  options?: { cwd?: string },
): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "/app/src/index.ts", ...args], {
    cwd: options?.cwd ?? process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

/**
 * Parses the stdout of a CLI invocation as JSON.
 *
 * @param raw - Raw stdout string from runCli()
 * @returns Parsed JSON value
 * @throws Error if raw is empty or not valid JSON
 *
 * Usage: const parsed = parseJsonOutput<{ ok: boolean }>(result.stdout);
 *
 * // The cast is safe here because callers supply T based on the known CLI contract.
 * // Callers are responsible for narrowing ok before accessing value.
 */
export function parseJsonOutput<T = unknown>(raw: string): T {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("parseJsonOutput: stdout was empty");
  }
  return JSON.parse(trimmed) as T;
}
```

**Design constraints**:
- Uses `Bun.spawn`, not `execa` or `child_process.spawn` — Bun is the runtime, use its native API.
- `["bun", "/app/src/index.ts", ...args]` — the CLI entry point is always at the absolute path `/app/src/index.ts` inside the container. This works because the source is bind-mounted at `/app`.
- `stdout: "pipe"` and `stderr: "pipe"` — capture both streams for assertion.
- `proc.exited` returns the exit code as a number. Do not call `proc.kill()` — let the process run to completion.
- `parseJsonOutput<T>` is generic for typed call sites. Tests MUST use typed generics (e.g. `parseJsonOutput<{ ok: boolean; value: unknown[] }>(result.stdout)`) rather than `any`-cast.
- Error responses from the CLI are written to **stderr** (exit code 1) or stderr (exit code 2). Tests asserting on error shape must parse `result.stderr`, not `result.stdout`.
- For exit code 2 (usage errors), the CLI writes JSON to stderr. `parseJsonOutput` can be called on `result.stderr` in those cases.

---

#### 3.6 `e2e/helpers/repo.ts`

**Purpose**: Fixture repo lifecycle management — copy the template to a fresh temp dir, and clean it up after each test.

**File path**: `e2e/helpers/repo.ts`

**Full specification**:

```typescript
import { mkdtemp, cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Absolute path to the baked fixture repo template inside the Docker container.
 * This directory is copied for each test to ensure full isolation.
 */
export const FIXTURE_TEMPLATE = "/fixtures/repo-template";

/**
 * A live test repo — a temp copy of the fixture template.
 */
export interface TestRepo {
  /** Absolute path to the isolated temp directory for this test. Pass as `cwd` to runCli(). */
  dir: string;
  /** Removes the temp directory. Call in afterEach(). */
  cleanup: () => Promise<void>;
}

/**
 * Creates an isolated copy of the fixture repo template.
 *
 * Each call produces a distinct temp directory under the OS temp dir.
 * The copied directory contains:
 *   - src/file-a.ts and src/file-b.ts (git-tracked source files)
 *   - .ai/external-context-gatherer_cache/sample-external.json (stale external entry)
 *   - .ai/local-context-gatherer_cache/context.json (stale local entry)
 *   - .git/ (a real git repo with one commit tracking src/ files)
 *
 * IMPORTANT: The fixture template's .gitignore excludes .ai/, so git does
 * not track the cache files — but they ARE present on disk.
 *
 * Usage:
 *   let repo: TestRepo;
 *   beforeEach(async () => { repo = await createTestRepo(); });
 *   afterEach(async () => { await repo.cleanup(); });
 *   // in test:
 *   const result = await runCli(["list"], { cwd: repo.dir });
 */
export async function createTestRepo(): Promise<TestRepo> {
  const dir = await mkdtemp(join(tmpdir(), "cache-ctrl-e2e-"));
  await cp(FIXTURE_TEMPLATE, dir, { recursive: true });
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
```

**Design constraints**:
- `cp(FIXTURE_TEMPLATE, dir, { recursive: true })` copies the entire tree including hidden directories (`.git/`, `.ai/`, `.gitignore`).
- The `cleanup` function uses `{ force: true }` — silently succeeds even if the directory was already removed by the test itself.
- `cleanup` must always be called in `afterEach` — the spec mandates this. Each test file must follow the standard pattern shown in the JSDoc.
- `FIXTURE_TEMPLATE` is a constant, not a configuration parameter. It is always `/fixtures/repo-template` (the Docker bake path). Running e2e tests outside Docker will fail because this path will not exist — this is intentional and acceptable.
- The `.git/` directory inside the copy is a fully functioning standalone repo (it is not a clone and has no remote). `git` commands in tests (`git rm`, `git add`, `git commit`) work immediately.
- **`.git/` copy reliability**: `node:fs/promises` `cp` with `{ recursive: true }` should copy `.git/` directories correctly in Node.js 18+ and Bun. However, if test environments encounter issues with `.git/` not being copied (which can happen with some symlink configurations), a fallback using `execFile("cp", ["-r", src, dst])` is acceptable. The spec does not mandate this fallback but implementors should be aware of the limitation.

---

### Feature 5: E2E Test Files

#### Shared test setup pattern

Every test file MUST follow this setup:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runCli, parseJsonOutput } from "../helpers/cli.ts";
import { createTestRepo, type TestRepo } from "../helpers/repo.ts";

let repo: TestRepo;

beforeEach(async () => {
  repo = await createTestRepo();
});

afterEach(async () => {
  await repo.cleanup();
});
```

All `runCli` calls in a test file use `{ cwd: repo.dir }`.

For tests that need a clean cache (no `.ai/`), add: `await rm(join(repo.dir, ".ai"), { recursive: true, force: true });` at the start of that specific test (not in `beforeEach`).

---

#### 3.7 `e2e/tests/smoke.e2e.test.ts`

**Purpose**: Full-pipeline integration tests verifying multiple commands work together in sequence.

```
describe("smoke: external cache pipeline")
  it("write external → list → inspect → search → invalidate → list again")
    Setup: rm .ai/ for clean state
    1. runCli(["write", "external", "mysmoke", "--data", JSON.stringify({ subject: "mysmoke", description: "smoke test external entry", fetched_at: "2026-04-01T00:00:00Z", sources: [], header_metadata: {} })], { cwd: repo.dir })
       Assert: exitCode === 0, parseJsonOutput(stdout).ok === true
    2. runCli(["list", "--agent", "external"], { cwd: repo.dir })
       Assert: exitCode === 0, value array length >= 1, at least one entry has subject "mysmoke"
    3. runCli(["inspect", "external", "mysmoke"], { cwd: repo.dir })
       Assert: exitCode === 0, value.subject === "mysmoke", value.description present
    4. runCli(["search", "mysmoke"], { cwd: repo.dir })
       Assert: exitCode === 0, value array includes entry with subject "mysmoke"
    5. runCli(["invalidate", "external", "mysmoke"], { cwd: repo.dir })
       Assert: exitCode === 0, value.invalidated.length >= 1
    6. runCli(["list", "--agent", "external"], { cwd: repo.dir })
       Assert: exitCode === 0, entry for "mysmoke" has is_stale === true

  Note on JSON data arg: the `--data` value must be a single-element JSON string.
  Construct it in the test as JSON.stringify({...}) and pass as a single string argument.
  No shell escaping needed — Bun.spawn receives args as an array, not a shell string.
  The external write data object must include `header_metadata: {}` for schema validation to pass.

describe("smoke: local cache pipeline")
  it("write local → check-files → invalidate → check-files again")
    Setup: rm .ai/ for clean state
    1. runCli(["write", "local", "--data", JSON.stringify({ topic: "smoke", description: "smoke test", tracked_files: [] })], { cwd: repo.dir })
       Assert: exitCode === 0, ok === true
    2. runCli(["check-files"], { cwd: repo.dir })
       Assert: exitCode === 0, value.status === "unchanged" (empty tracked_files means no files to check)
    3. runCli(["invalidate", "local"], { cwd: repo.dir })
       Assert: exitCode === 0, value.invalidated.length >= 1
    4. runCli(["list", "--agent", "local"], { cwd: repo.dir })
       Assert: entry's is_stale is determined by timestamp being zeroed; assert is_stale === true
```

---

#### 3.8 `e2e/tests/list.e2e.test.ts`

**Purpose**: Verify `list` command output shape, agent filtering, and error handling.

```
describe("list")
  it("exits 0 and returns ok:true with empty results when no .ai dir exists")
    Setup: rm .ai/ from repo.dir
    runCli(["list"], { cwd: repo.dir })
    Assert: exitCode === 0
    parseJsonOutput: ok === true, value is an array of length 0

  it("lists all entries when --agent all (or no --agent flag)")
    Use fixture as-is (has 1 external + 1 local entry)
    runCli(["list", "--agent", "all"], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true
    Assert: value.length === 2
    Assert: value contains entries with agent "external" and agent "local"

  it("filters to external only with --agent external")
    Use fixture as-is
    runCli(["list", "--agent", "external"], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true
    Assert: every entry in value has agent === "external"

  it("filters to local only with --agent local")
    Use fixture as-is
    runCli(["list", "--agent", "local"], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true
    Assert: every entry in value has agent === "local"

  it("invalid --agent value exits with code 2")
    runCli(["list", "--agent", "invalid"], { cwd: repo.dir })
    Assert: exitCode === 2
    parseJsonOutput(result.stderr): ok === false, code === "INVALID_ARGS"
```

**Response shape** for each entry in `value`:
```typescript
// Partial shape — additional fields may be present. Assert only the fields listed here.
{
  agent: "external" | "local",
  subject: string,
  description: string,
  age_human: string,
  is_stale: boolean,
}
```
Tests must assert `ok === true` before accessing `value` to satisfy TypeScript's type narrowing.

---

#### 3.9 `e2e/tests/inspect.e2e.test.ts`

**Purpose**: Verify `inspect` returns full entry content and handles missing/invalid inputs correctly.

```
describe("inspect")
  it("returns ok:true and full entry content for known external subject")
    Use fixture as-is (has sample-external.json with subject "sample")
    runCli(["inspect", "external", "sample"], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true
    Assert: value.subject === "sample"
    Assert: value.description is a non-empty string
    Assert: value.fetched_at is a non-empty string
    Assert: value.sources is an array

  it("returns ok:false with FILE_NOT_FOUND for unknown subject")
    runCli(["inspect", "external", "does-not-exist"], { cwd: repo.dir })
    Assert: exitCode === 1
    parseJsonOutput(result.stderr): ok === false, code === "FILE_NOT_FOUND"

  it("returns ok:false with INVALID_ARGS for invalid agent")
    runCli(["inspect", "badagent", "sample"], { cwd: repo.dir })
    Assert: exitCode === 2
    parseJsonOutput(result.stderr): ok === false, code === "INVALID_ARGS"

  it("missing subject arg exits with code 2")
    runCli(["inspect", "external"], { cwd: repo.dir })
    Assert: exitCode === 2
    parseJsonOutput(result.stderr): ok === false, code === "INVALID_ARGS"

  it("missing both agent and subject exits with code 2")
    runCli(["inspect"], { cwd: repo.dir })
    Assert: exitCode === 2
    parseJsonOutput(result.stderr): ok === false, code === "INVALID_ARGS"
```

---

#### 3.10 `e2e/tests/write.e2e.test.ts`

**Purpose**: Verify `write` validates input, creates files, and handles all error conditions.

```
describe("write external")
  it("writes valid external entry and exits 0")
    Setup: rm .ai/ for clean state
    Data: { subject: "mywrite", description: "test", fetched_at: "2026-04-01T00:00:00Z", sources: [], header_metadata: {} }
    runCli(["write", "external", "mywrite", "--data", JSON.stringify(data)], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true, value.file ends with "mywrite.json"
    Verify: file exists at repo.dir/.ai/external-context-gatherer_cache/mywrite.json

  it("fails with VALIDATION_ERROR for missing required field")
    Data: { subject: "bad", fetched_at: "...", sources: [], header_metadata: {} }
    (missing description)
    runCli(["write", "external", "bad", "--data", JSON.stringify(data)], { cwd: repo.dir })
    Assert: exitCode === 1
    parseJsonOutput(result.stderr): ok === false, code === "VALIDATION_ERROR"

  it("fails with INVALID_ARGS when subject arg missing for external")
    Data: { description: "test", fetched_at: "...", sources: [], header_metadata: {} }
    runCli(["write", "external", "--data", JSON.stringify(data)], { cwd: repo.dir })
    Assert: exitCode === 1  // business-logic validation, not usage error — CLI uses 1 for non-usage errors, 2 for usage/arg errors
    parseJsonOutput(result.stderr): ok === false, code === "INVALID_ARGS"

  it("--data must be valid JSON — exits 2 on invalid JSON string")
    runCli(["write", "external", "test", "--data", "not-valid-json"], { cwd: repo.dir })
    Assert: exitCode === 2
    parseJsonOutput(result.stderr): ok === false, code === "INVALID_ARGS"

  it("missing --data flag exits with code 2")
    runCli(["write", "external", "test"], { cwd: repo.dir })
    Assert: exitCode === 2
    parseJsonOutput(result.stderr): ok === false, code === "INVALID_ARGS"

describe("write local")
  it("writes valid local entry and exits 0")
    Setup: rm .ai/ for clean state
    Data: { topic: "e2e test", description: "local write test", tracked_files: [] }
    runCli(["write", "local", "--data", JSON.stringify(data)], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true, value.file ends with "context.json"

  it("auto-computes mtime for tracked files — caller-provided mtime is ignored")
    Setup: rm .ai/ for clean state
    Note: src/file-a.ts exists in repo.dir (from fixture)
    Data: { topic: "mtime test", description: "test", tracked_files: [{ path: "src/file-a.ts", mtime: 1, hash: "fake" }] }
    runCli(["write", "local", "--data", JSON.stringify(data)], { cwd: repo.dir })
    Assert: exitCode === 0
    Read context.json from disk and parse
    Assert: tracked_files[0].mtime !== 1 (CLI replaced caller-provided value)
    Assert: tracked_files[0].hash matches /^[0-9a-f]{64}$/ (real SHA-256, not "fake")
```

---

#### 3.11 `e2e/tests/check-files.e2e.test.ts`

**Purpose**: Verify `check-files` compares cache entries against disk state and reports changes correctly.

```
describe("check-files")
  it("returns FILE_NOT_FOUND when no local cache exists")
    Setup: rm .ai/ from repo.dir
    runCli(["check-files"], { cwd: repo.dir })
    Assert: exitCode === 1
    parseJsonOutput(result.stderr): ok === false, code === "FILE_NOT_FOUND"

  it("returns status:changed when fixture cache has stale mtime for tracked files")
    Use fixture as-is — context.json has placeholder mtime 1735689600000
    Copied files will have current mtime, so mtime will differ
    runCli(["check-files"], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true
    Assert: value.status === "changed"
    Assert: value.changed_files contains an entry with path "src/file-a.ts" or "src/file-b.ts"

  it("returns status:unchanged after writing cache with correct mtime values")
    Setup: rm .ai/ for clean state
    Step 1: Write local cache with empty tracked_files
      runCli(["write", "local", "--data", JSON.stringify({ topic: "t", description: "d", tracked_files: [] })])
      Assert: exitCode === 0
    Step 2: runCli(["check-files"], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true
    Assert: value.status === "unchanged"
    Assert: value.changed_files.length === 0

  it("returns new_files when an untracked-non-ignored file exists not in cache")
    Setup: Write local cache with empty tracked_files
    Create a new file: write 'export const newFile = 1;' to repo.dir/src/new-file.ts
    (Do NOT git add it — it remains untracked but non-ignored)
    runCli(["check-files"], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true
    Assert: value.status === "changed"
    Assert: value.new_files contains "src/new-file.ts"

  it("returns deleted_git_files when a git-tracked file is removed from working tree")
    Setup: Write local cache tracking src/file-a.ts with its real mtime+hash
      (Use write command, then parse context.json to confirm tracking)
    Delete src/file-a.ts from disk (rm)
    runCli(["check-files"], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true
    Assert: value.status === "changed"
    Assert: value.deleted_git_files contains "src/file-a.ts"
    Assert: value.missing_files contains "src/file-a.ts"

    Note: The assertion `value.missing_files contains "src/file-a.ts"` requires
    that the local cache was written tracking src/file-a.ts specifically. If the
    write setup uses empty tracked_files, src/file-a.ts will appear in
    deleted_git_files but NOT in missing_files. The setup step must use:
      tracked_files: [{ path: "src/file-a.ts" }]
    (the write command will auto-compute mtime and hash).

  Note: "git-tracked" means the file was in the initial fixture commit.
  src/file-a.ts and src/file-b.ts are committed. Deleting one from disk triggers deleted_git_files.
```

---

#### 3.12 `e2e/tests/invalidate.e2e.test.ts`

**Purpose**: Verify `invalidate` zeroes timestamps and reflects staleness in subsequent `list`.

```
describe("invalidate")
  it("invalidates specific external entry by subject keyword")
    Use fixture as-is (sample-external.json has subject "sample")
    runCli(["invalidate", "external", "sample"], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true
    Assert: value.invalidated.length === 1

  it("after invalidate, list shows entry as stale")
    Step 1: runCli(["invalidate", "external", "sample"], { cwd: repo.dir })
    Step 2: runCli(["list", "--agent", "external"], { cwd: repo.dir })
    Assert: entry with subject "sample" has is_stale === true

  it("invalidates all local entries (no subject arg)")
    Use fixture as-is
    runCli(["invalidate", "local"], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true, value.invalidated.length >= 1

  it("missing agent arg exits with code 2")
    runCli(["invalidate"], { cwd: repo.dir })
    Assert: exitCode === 2
    parseJsonOutput(result.stderr): ok === false, code === "INVALID_ARGS"

  it("invalid agent value exits with code 2")
    runCli(["invalidate", "notanagent"], { cwd: repo.dir })
    Assert: exitCode === 2
    parseJsonOutput(result.stderr): ok === false, code === "INVALID_ARGS"
```

---

#### 3.13 `e2e/tests/flush.e2e.test.ts`

**Purpose**: Verify `flush` is destructive, requires `--confirm`, and removes files correctly.

```
describe("flush")
  it("flushes all external entries with --confirm")
    Use fixture as-is
    runCli(["flush", "external", "--confirm"], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true
    Assert: value.count >= 1
    Assert: value.deleted contains at least one path ending in ".json"
    Verify: after flush, runCli(["list", "--agent", "external"]) returns value of length 0

  it("without --confirm, flush returns error with code CONFIRMATION_REQUIRED")
    runCli(["flush", "external"], { cwd: repo.dir })
    Assert: exitCode === 1
    parseJsonOutput(result.stderr): ok === false, code === "CONFIRMATION_REQUIRED"

  it("flush all --confirm removes both agents")
    Use fixture as-is
    runCli(["flush", "all", "--confirm"], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true
    Assert: value.count === 2 (1 external + 1 local in fixture)
    Verify: runCli(["list"]) returns value of length 0

  it("missing agent arg exits with code 2")
    runCli(["flush", "--confirm"], { cwd: repo.dir })
    Assert: exitCode === 2
    parseJsonOutput(result.stderr): ok === false, code === "INVALID_ARGS"

  it("invalid agent exits with code 2")
    runCli(["flush", "badagent", "--confirm"], { cwd: repo.dir })
    Assert: exitCode === 2
    parseJsonOutput(result.stderr): ok === false, code === "INVALID_ARGS"
```

---

#### 3.14 `e2e/tests/search.e2e.test.ts`

**Purpose**: Verify `search` returns ranked results and handles edge cases.

```
describe("search")
  it("finds external entry by subject keyword")
    Use fixture as-is (subject "sample")
    runCli(["search", "sample"], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true
    Assert: value is an array with at least one entry
    Assert: at least one entry has subject containing "sample"
    Assert: entries are sorted descending by score (value[0].score >= value[1].score if multiple)

  it("finds local entry by description keyword")
    Use fixture as-is (local entry has description "Pre-populated local cache for e2e fixture")
    runCli(["search", "fixture"], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true
    Assert: at least one entry in value has agent === "local"

  it("returns empty results array for unknown keyword")
    runCli(["search", "xyzzy-nonexistent-keyword-9999"], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true
    Assert: value is an empty array

  it("missing keyword arg exits with code 2")
    runCli(["search"], { cwd: repo.dir })
    Assert: exitCode === 2
    parseJsonOutput(result.stderr): ok === false, code === "INVALID_ARGS"
```

**Response shape** for each entry in `value`:
```typescript
{
  subject: string,
  agent: "external" | "local",
  description: string,
  score: number,
}
```

---

#### 3.15 `e2e/tests/touch.e2e.test.ts`

**Purpose**: Verify `touch` refreshes timestamps to now without destroying entry content.

```
describe("touch")
  it("refreshes fetched_at timestamp of a matched external entry")
    Use fixture as-is (sample-external.json with old fetched_at)
    Record time before: const before = Date.now()
    runCli(["touch", "external", "sample"], { cwd: repo.dir })
    Record time after: const after = Date.now()
    Assert: exitCode === 0, ok === true
    Assert: value.touched contains a path ending in "sample.json"
    Assert: new Date(value.new_timestamp).getTime() >= before
    Assert: new Date(value.new_timestamp).getTime() <= after
    Verify: runCli(["list", "--agent", "external"], { cwd: repo.dir }) — find entry with subject "sample" and assert entry.is_stale === false
      (touch makes entry fresh again because new timestamp is < 24h old)
    // Add a ±500ms buffer to timestamp assertions if these tests are flaky on slow CI:
    // Assert: new Date(value.new_timestamp).getTime() >= before - 500
    // Assert: new Date(value.new_timestamp).getTime() <= after + 500

  it("touches local entry (timestamp updated to now)")
    Use fixture as-is
    Note: This test uses the fixture as-is (which has .ai/ pre-populated).
    Do NOT precede this test with a `rm .ai/` setup step — touch.ts does not
    guard against a missing local cache file for agent "local", and calling
    touch on a non-existent file may produce unexpected behavior.
    const before = Date.now()
    runCli(["touch", "local"], { cwd: repo.dir })
    const after = Date.now()
    Assert: exitCode === 0, ok === true
    Assert: value.touched.length >= 1
    Assert: new Date(value.new_timestamp).getTime() is within [before, after]
    // Add a ±500ms buffer to timestamp assertions if these tests are flaky on slow CI:
    // Assert: new Date(value.new_timestamp).getTime() >= before - 500
    // Assert: new Date(value.new_timestamp).getTime() <= after + 500

  it("missing agent arg exits with code 2")
    runCli(["touch"], { cwd: repo.dir })
    Assert: exitCode === 2
    parseJsonOutput(result.stderr): ok === false, code === "INVALID_ARGS"

  it("invalid agent exits with code 2")
    runCli(["touch", "badagent"], { cwd: repo.dir })
    Assert: exitCode === 2
    parseJsonOutput(result.stderr): ok === false, code === "INVALID_ARGS"
```

---

#### 3.16 `e2e/tests/prune.e2e.test.ts`

**Purpose**: Verify `prune` dry-run reports stale entries and `--delete` removes them.

```
describe("prune")
  it("dry-run lists stale entries without deleting them")
    Use fixture as-is (both entries have old timestamps — they are stale)
    runCli(["prune"], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true
    Assert: value.matched is an array of length >= 1 (the stale fixture entries)
    Assert: value.action === "invalidated" (dry-run mode — entries are invalidated but files are NOT deleted)
    Verify: runCli(["list"]) still returns both entries (nothing deleted)

  Note: Despite being called a "dry-run", prune without --delete DOES mutate files —
  it invalidates entries by zeroing their timestamps (sets fetched_at: "" for external,
  timestamp: "" for local). Files are modified but NOT deleted. The test comment
  "without deleting them" refers to file deletion, not mutation. Test authors should
  inspect the fixture state after dry-run prune if they depend on timestamp values.

  it("--delete removes stale entries")
    Use fixture as-is
    runCli(["prune", "--delete"], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true
    Assert: value.matched.length >= 1
    Assert: value.action === "deleted"
    Verify: runCli(["list"]) returns fewer entries than before prune (some were deleted)

  it("--max-age filters: entries newer than threshold are not pruned")
    Setup: Touch the external sample entry to make it fresh (use touch command)
    runCli(["prune", "--max-age", "1h"], { cwd: repo.dir })
    // Using 1h instead of 24h so the freshly-touched entry is clearly within threshold
    Assert: exitCode === 0, ok === true
    Assert: value.matched does NOT include the freshly-touched external entry
    (local entry remains stale since it was only touched if this test does so)

  it("--agent filters to specific agent")
    Use fixture as-is
    runCli(["prune", "--agent", "external"], { cwd: repo.dir })
    Assert: exitCode === 0, ok === true
    Assert: all entries in value.matched have agent === "external"

  it("invalid --agent exits with code 2")
    runCli(["prune", "--agent", "badvalue"], { cwd: repo.dir })
    Assert: exitCode === 2
    parseJsonOutput(result.stderr): ok === false, code === "INVALID_ARGS"
```

**Note on prune response shape**: The actual `pruneCommand` return value is `{ ok: true, value: { matched: PrunedEntry[], action: "invalidated" | "deleted" } }`. Dry-run (no `--delete`) returns `action: "invalidated"` — entries have their timestamps zeroed (invalidated) but files are NOT deleted. With `--delete`, returns `action: "deleted"` — stale entry files are removed from disk. Verify against `src/commands/prune.ts` if behavior changes.

---

#### 3.17 `e2e/tests/help.e2e.test.ts`

**Purpose**: Verify the `--help` flag and `help` command produce usable CLI documentation.

```
describe("help")
  it("--help flag exits 0 and stdout contains 'Usage'")
    runCli(["--help"], { cwd: repo.dir })
    Assert: exitCode === 0
    Assert: result.stdout.includes("Usage")
    Assert: result.stdout.includes("cache-ctrl")

  it("--help lists all 10 command names in stdout")
    runCli(["--help"], { cwd: repo.dir })
    Assert: exitCode === 0
    For each of ["list","inspect","flush","invalidate","touch","prune","check-freshness","check-files","search","write"]:
      Assert: result.stdout.includes(commandName)

  it("help <command> shows command-specific usage")
    runCli(["help", "list"], { cwd: repo.dir })
    Assert: exitCode === 0
    Assert: result.stdout.includes("list")
    Assert: result.stdout.includes("--agent")

  it("help unknown-cmd exits 1 with stderr containing 'Unknown command'")
    runCli(["help", "unknown-cmd"], { cwd: repo.dir })
    Assert: exitCode === 1
    Assert: result.stderr.includes("Unknown command")

  it("no args exits 2 with INVALID_ARGS")
    runCli([], { cwd: repo.dir })
    Assert: exitCode === 2
    parseJsonOutput(result.stderr): ok === false, code === "INVALID_ARGS"
```

---

### Feature 6: package.json Update

#### 3.18 `package.json` script addition

**File path**: `cache-ctrl/package.json`

**Change**: Add `"test:e2e"` script to the `"scripts"` object.

**Before**:
```json
{
  "scripts": {
    "test": "bunx vitest run",
    "test:watch": "bunx vitest"
  }
}
```

**After**:
```json
{
  "scripts": {
    "test": "bunx vitest run",
    "test:watch": "bunx vitest",
    "test:e2e": "docker compose -f e2e/docker-compose.yml run --rm e2e"
  }
}
```

**Design constraints**:
- `--rm` removes the container after test completion — no orphaned containers.
- The command is run from `cache-ctrl/` (repo root for this package), so the `-f` path `e2e/docker-compose.yml` resolves correctly.
- Developers run `bun run test:e2e` or directly `docker compose -f e2e/docker-compose.yml run --rm e2e`.

---

## 4. Integration Notes

### How to run

```bash
# From cache-ctrl/ directory:
bun run test:e2e

# Or directly:
docker compose -f e2e/docker-compose.yml run --rm e2e

# Or from the e2e/ directory:
docker compose run --rm e2e
```

On first run, Docker builds the image (installs `git`, copies fixtures, runs `git init`). Subsequent runs reuse the cached image unless `e2e/Dockerfile` or `e2e/fixtures/` change.

### How helpers interact

```
Test File
  └── createTestRepo() → copies /fixtures/repo-template → returns { dir, cleanup }
  └── runCli(args, { cwd: repo.dir }) → Bun.spawn(["bun", "/app/src/index.ts", ...args])
       └── CLI process reads/writes repo.dir/.ai/**
  └── parseJsonOutput(result.stdout) → typed JSON parse of CLI output
  └── repo.cleanup() → rm -rf repo.dir
```

### Sequencing of critical e2e operations

1. `createTestRepo` must complete before `runCli` is called.
2. `runCli` resolves when the spawned process exits — always await it.
3. `cleanup` must run in `afterEach` even if the test fails — use `afterEach`, not `try/finally` inside `it`.
4. Tests that verify file state after a CLI call must `await` the CLI call first, then `readFile`.
5. Multi-step tests (like smoke) must `await` each step in sequence — they are inherently serial.

### tsconfig inclusion

The `e2e/` directory and helpers must be included in TypeScript checking. Update `tsconfig.json`'s `include` array from:

```json
"include": ["src/**/*", "cache_ctrl.ts", "tests/**/*"]
```

to:

```json
"include": ["src/**/*", "cache_ctrl.ts", "tests/**/*", "e2e/**/*"]
```

This ensures `cli.ts`, `repo.ts`, and all test files are type-checked.

---

## 5. Constraints and Invariants

### Mandatory invariants — the implementation MUST guarantee all of these:

#### Isolation

1. **No shared mutable state between tests**: every test gets a fresh `repo.dir` copy via `createTestRepo()`. Test order must not affect outcomes.
2. **No `process.chdir()` in e2e tests**: the subprocess receives `cwd` via `Bun.spawn` options. The test process itself never changes directory.
3. **cleanup always runs**: `afterEach(async () => { await repo.cleanup(); })` is non-negotiable. If cleanup is in a `try/finally` inside `it`, a test failure before cleanup can leave temp dirs. `afterEach` runs regardless of test outcome.

#### Subprocess behavior

4. **Never inspect `result.stdout` for error responses**: when `exitCode !== 0`, the CLI writes errors to **stderr**. Tests asserting on error shape must parse `result.stderr`.
5. **Bun.spawn array args, not shell string**: `runCli` passes args as an array to `Bun.spawn`. No shell interpolation occurs. JSON data passed via `--data` must be constructed with `JSON.stringify()` and passed as a single array element — not wrapped in shell quotes.
6. **Wait for process exit**: always `await runCli(...)`. Never fire-and-forget.

#### JSON assertions

7. **Typed generics on parseJsonOutput**: always specify the type parameter: `parseJsonOutput<{ ok: boolean; value: SomeType }>(result.stdout)`. Using `unknown` or `any` is permitted but the `ok` field must be narrowed before accessing `value`.
8. **Assert `ok === true` before accessing `value`**: TypeScript's `exactOptionalPropertyTypes` enforcement means accessing `result.value` without narrowing will be a compile error if the type is `Result<T>`.

#### Fixture integrity

9. **Fixture template is read-only in image**: `createTestRepo` copies the template but never modifies `/fixtures/repo-template` itself. Tests must never call `runCli` with `{ cwd: FIXTURE_TEMPLATE }`.
10. **`.ai/` is not git-tracked in fixture**: The fixture's `.gitignore` excludes `.ai/`. Tests relying on `deleted_git_files` detection work correctly because `src/file-a.ts` and `src/file-b.ts` are committed, not the cache files.
11. **Placeholder mtimes guarantee changed state**: The fixture's `context.json` stores `mtime: 1735689600000`. Copied files will have current mtime, so `check-files` will always report `status: "changed"` against the fixture cache. Tests that need `status: "unchanged"` must call `write local` first.

#### Docker environment

12. **Source is bind-mounted, not COPY-ed**: No `COPY src/` in the Dockerfile. Source changes on the host are immediately visible inside the container via the `/app` bind-mount. The image does NOT need to be rebuilt when source code changes.
13. **`bun install` runs at container start**: The CMD in the Dockerfile begins with `bun install`. This ensures `node_modules` is up to date based on `bun.lock`. If `bun.lock` changes, the next `docker compose run` will reinstall automatically.
14. **E2E tests do not run in the default `bun run test`**: The default vitest config does not include `e2e/tests/**`. E2E tests only run via `bun run test:e2e` or direct docker compose invocation.

---

## 6. Open Questions / Implementation Notes

1. **`prune` response shape**: The confirmed shape from `src/commands/prune.ts` is `{ ok: true, value: { matched: PrunedEntry[], action: "invalidated" | "deleted" } }`. Dry-run (default, no `--delete`) returns `action: "invalidated"` — entry timestamps are zeroed but files remain on disk. With `--delete` returns `action: "deleted"` — stale files are physically removed. The old field names `pruned`, `dry_run`, `listed`, and `deleted` are not used — do not assert them.

2. **`check-freshness` e2e**: `check-freshness` makes real HTTP HEAD requests. It is not included in the E2E test files listed above because it would introduce network dependency and flakiness. If desired in the future, consider a dedicated describe block with `it.skipIf(!process.env.E2E_NETWORK)` guards or a mock HTTP server setup in Docker.

3. **Image rebuild trigger**: If `e2e/fixtures/` changes, the Docker image must be rebuilt (`docker compose build`). Consider adding a CI step or a Makefile target that always rebuilds the image before running e2e tests.

4. **Windows/macOS host paths**: `/tmp` is available inside the Docker container regardless of host OS. `tmpdir()` returns `/tmp` inside Linux containers. No platform-specific path handling needed in the helper.

5. **Vitest config path from working dir**: The CMD uses `bunx vitest run --config e2e/vitest.config.ts`. The `WORKDIR /app` in the Dockerfile means this path resolves relative to `/app`, i.e. `/app/e2e/vitest.config.ts`. This is correct because the source is bind-mounted to `/app`.

---

## 7. Revision History

| Date | Fixes Applied | Summary |
|---|---|---|
| 2026-04-06 | I1–I7, S1–S5 | Applied 7 blocker fixes and 5 suggestions from initial review |
| 2026-04-06 | B1, B2, S6, S7, S8, S9 | Applied 2 blockers (prune action value, dockerignore placement) and 4 suggestions from second review pass |

### Revision 2026-04-06 — Detail

**Blocker fixes applied:**
- **I1**: `value.count` → `value.invalidated.length` in `invalidate` tests (section 3.12) and smoke test step 5 (section 3.7). Actual CLI response shape is `{ ok: true, value: { invalidated: Array<...> } }`.
- **I2**: `value.pruned` → `value.matched`, `value.dry_run === true` → `value.action === "listed"`, `value.deleted === false` → `value.action === "listed"` in prune tests (section 3.16) and open questions (section 6). Actual prune response is `{ ok: true, value: { matched: PrunedEntry[], action: "listed" | "invalidated" } }`.
- **I3**: Added inline comment to `write` test "fails with INVALID_ARGS when subject arg missing for external" clarifying `exitCode === 1` is a business-logic validation exit (not usage error). CLI uses 1 for non-usage errors, 2 for usage/arg errors.
- **I4**: Added `// Partial shape — additional fields may be present. Assert only the fields listed here.` comment to `list` response shape block (section 3.8).
- **I5**: Added `node_modules/` as second line in fixture `.gitignore` (section 3.4.1). Added note explaining that `node_modules/` must be excluded because `bun install` bind-mounts it back to host.
- **I6**: Added `e2e/.dockerignore` to file tree (section 2) and new subsection 3.1b with full specification (purpose, file path, contents, and design constraints including Docker < 23 compatibility note).
- **I7**: Added `.git/` copy reliability bullet to `repo.ts` design constraints (section 3.6) noting the `execFile("cp", ["-r", ...])` fallback option for environments with symlink issues.

**Suggestions applied:**
- **S1**: Removed unused `import type { SpawnOptions } from "bun"` from `cli.ts` spec (section 3.5). All Bun globals are available without import in the Bun runtime.
- **S2**: Added JSDoc note to `parseJsonOutput` in `cli.ts` spec (section 3.5) justifying the `as T` cast: callers supply T based on the known CLI contract and are responsible for narrowing `ok` before accessing `value`.
- **S3**: Added `±500ms` buffer timing note to both `touch` timestamp assertions in section 3.15 to prevent flakiness on slow CI.
- **S4**: Changed `--max-age 24h` to `--max-age 1h` in prune filter test (section 3.16) with explanatory note: 1h clearly keeps freshly-touched entries within threshold.
- **S5**: Updated smoke test external write data in section 3.7 to include `header_metadata: {}` so write passes schema validation. Replaced placeholder `'<valid-external-json>'` with explicit `JSON.stringify({...})` call showing the complete required object.

---

### Revision 2026-04-06 (v3) — Detail

**Blocker fixes applied:**
- **B1**: Fixed `prune` action values throughout. `value.action === "listed"` does not exist in the code. Changed dry-run assertion in §3.16 test 1 to `value.action === "invalidated"`. Added `value.action === "deleted"` assertion to §3.16 test 2 (`--delete`). Updated "Note on prune response shape" union type from `"listed" | "invalidated"` to `"invalidated" | "deleted"` with clarification: dry-run returns `"invalidated"` (files mutated, not deleted), `--delete` returns `"deleted"`. Updated §6 item 1 to remove `"listed"` and `"deleted"` from the old field names list and correct the union type.
- **B2**: Fixed `.dockerignore` placement to build context root. Moved `.dockerignore` in §2 file tree from inside `e2e/` to `cache-ctrl/` root level. Updated §3.1b file path from `e2e/.dockerignore` to `cache-ctrl/.dockerignore`. Updated purpose to state it sits at the build context root. Replaced the incorrect design constraint ("Docker picks up `.dockerignore` from the same directory as the Dockerfile") with the correct placement note: standard Docker resolves from build context root; `e2e/.dockerignore` is only honored with BuildKit enabled (`DOCKER_BUILDKIT=1`), which is non-default.

**Suggestions applied:**
- **S6**: Added note block to §3.16 test 1 (dry-run) clarifying that prune without `--delete` DOES mutate files (zeroes timestamps) — files are modified but not deleted. Test authors must inspect fixture state after dry-run if they depend on timestamp values.
- **S7**: Added guard note to §3.15 "touches local entry" test: do NOT precede with `rm .ai/` — `touch.ts` does not guard against a missing local cache file and calling touch on a non-existent file may produce unexpected behavior.
- **S8**: Fixed `inspect` `is_stale` assertion in §3.15 test 1 ("refreshes fetched_at timestamp"). `inspect` returns raw file content (no `is_stale` field); `is_stale` is only present in `list` entries. Changed assertion from `runCli(["inspect", ...]) returns value.is_stale === false` to `runCli(["list", "--agent", "external"], { cwd: repo.dir }) — find entry with subject "sample" and assert entry.is_stale === false`.
- **S9**: Added dependency note to §3.11 "returns deleted_git_files" test clarifying that `value.missing_files contains "src/file-a.ts"` requires the cache was written with `tracked_files: [{ path: "src/file-a.ts" }]`; empty `tracked_files` will not produce a `missing_files` entry.

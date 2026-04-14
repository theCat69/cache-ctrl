---
name: project-test
description: Project-specific testing guidelines, test framework conventions, patterns, and coverage requirements
---

# Project Testing Guide

This project uses **Vitest 4.1.2** for both unit and E2E tests. Tests are a first-class citizen — they function as living documentation of the CLI's behavior.

---

## Test Framework

- **Vitest** — configured in `vitest.config.ts` at the project root
- **Bun** as the test runner: `bunx vitest run`
- **No test doubles library** — use `vi.fn()`, `vi.spyOn()`, `vi.mock()` from Vitest's built-in API
- **No assertion library** — use Vitest's `expect` API directly

---

## Test Location & File Naming

### Unit Tests (`tests/`)

Mirror the `src/` directory structure exactly:

```
src/commands/write.ts       →  tests/commands/write.test.ts
src/files/changeDetector.ts →  tests/files/changeDetector.test.ts
src/validation.ts          →  tests/validation.test.ts
src/cache/cacheManager.ts   →  tests/cache/cacheManager.test.ts
```

- File naming: `<module>.test.ts`
- Shared test fixtures in `tests/fixtures/`

### E2E Tests (`e2e/`)

```
e2e/tests/<command>.e2e.test.ts   # one file per CLI command
e2e/helpers/                      # shared E2E helpers
e2e/fixtures/                     # E2E fixture data
```

- File naming: `<command>.e2e.test.ts`
- E2E tests run inside Docker via `docker compose -f e2e/docker-compose.yml run --rm e2e`

---

## Writing Tests

### Unit Test Structure

Follow the **AAA (Arrange / Act / Assert)** pattern:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCommand } from "../../src/commands/write.js";
import { ErrorCode } from "../../src/types/result.js";

let tmpDir: string;
let origCwd: string;

beforeEach(async () => {
  origCwd = process.cwd();
  tmpDir = await mkdtemp(join(tmpdir(), "cache-ctrl-test-"));
  process.chdir(tmpDir);           // isolate filesystem from real cwd
});

afterEach(async () => {
  process.chdir(origCwd);
  await rm(tmpDir, { recursive: true, force: true });
});

describe("writeCommand", () => {
  it("writes a valid external entry", async () => {
    // Arrange
    const content = { subject: "mysubject", description: "...", fetched_at: "...", sources: [] };

    // Act
    const result = await writeCommand({ agent: "external", subject: "mysubject", content });

    // Assert
    expect(result.ok).toBe(true);
    if (!result.ok) return;          // type narrowing after assertion
    expect(result.value.file).toContain("mysubject.json");
  });
});
```

### Key Conventions

- **Isolate filesystem with temp dirs**: every test that touches the filesystem creates a temp dir in `beforeEach`, changes `process.cwd()` to it, and cleans up in `afterEach`.
- **Narrow Result types after assertion**: always check `if (!result.ok) return;` or `if (result.ok) { ... }` after asserting `result.ok` to unlock typed fields.
- **Test behavior, not internals**: assert on the Result returned, the file content written, or the CLI output — not on internal function calls unless verifying integration points.
- **One describe block per command/module**: use nested `describe` for sub-scenarios.
- **Descriptive it() labels**: use present tense — `"returns FILE_NOT_FOUND when cache is missing"`, not `"test file not found"`.

---

## Mocking & Fixtures

### `vi.fn()` for Dependencies

```typescript
import { vi } from "vitest";

const mockReadFile = vi.fn().mockResolvedValue(JSON.stringify({ subject: "test" }));
vi.mock("node:fs/promises", () => ({ readFile: mockReadFile }));
```

### `vi.useFakeTimers()` for Time-Dependent Logic

```typescript
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it("marks entry as stale after 24h", () => {
  vi.setSystemTime(new Date("2026-04-10T00:00:00Z"));
  // ...
});
```

### Fixtures in `tests/fixtures/`

Store static JSON payloads and file content used across multiple test files. Keep fixtures minimal and named after the scenario they represent.

---

## Coverage Requirements

No formal coverage threshold is configured. The guiding principle:

- **Every public command function** must have at least one happy-path and one error-path test.
- **Every `ErrorCode` branch** in a command should be exercised.
- **Path traversal guards** in `changeDetector.ts` require explicit tests with `../` inputs.
- **Advisory lock behavior** (timeout, stale lock) should be covered in `tests/cache/`.
- E2E tests cover the CLI surface end-to-end — unit tests cover internal logic.

---

## Running Tests

```bash
# Run all unit tests once
bun run test

# Run unit tests in watch mode (re-runs on file change)
bun run test:watch

# Run E2E tests inside Docker
bun run test:e2e

# Run a specific test file
bunx vitest run tests/commands/write.test.ts

# Run tests matching a name pattern
bunx vitest run --testNamePattern "writes a valid"
```

---

## Vitest Config

The project vitest config is at `vitest.config.ts`. The E2E suite has its own config at `e2e/vitest.config.ts`. When adding new test directories, verify both configs include the relevant glob patterns.

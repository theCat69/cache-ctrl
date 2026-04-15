# E2E test pattern — testing daemon commands with runCliWithTimeout

## Pattern: spawn a long-running CLI process, let it initialize, then kill it

For commands that never exit on their own (e.g. `watch`), use `runCliWithTimeout` instead of
`runCli`. The helper kills the process after `timeoutMs` ms and returns `exitCode: -1` to signal
that the timeout fired (rather than a real exit). Use `exitCode: -1` as the success signal for
daemon tests — it means the process was still alive after the full initialization window.

```typescript
// e2e/tests/watch.e2e.test.ts

import { runCli, runCliWithTimeout } from "../helpers/cli.ts";
import { createTestRepo, type TestRepo } from "../helpers/repo.ts";

let repo: TestRepo;

beforeEach(async () => { repo = await createTestRepo(); });
afterEach(async () => { await repo.cleanup(); });

describe("watch", () => {
  it("builds the initial graph and writes graph.json", async () => {
    // exitCode -1 means the timeout fired — daemon was still alive (expected for watch)
    const result = await runCliWithTimeout(["watch", "--verbose"], 10_000, { cwd: repo.dir });

    expect(result.exitCode).toBe(-1);
    expect(result.stdout).toContain("[watch] Initial graph computed");

    const graphPath = join(repo.dir, ".ai", "local-context-gatherer_cache", "graph.json");
    expect(existsSync(graphPath)).toBe(true);
  });

  // For flag-validation tests, the command exits immediately — use plain runCli
  it("watch --unknown-flag exits with an argument error", async () => {
    const result = await runCli(["watch", "--unknown-flag"], { cwd: repo.dir });

    expect(result.exitCode).toBe(2);          // exit code 2 = INVALID_ARGS / bad arguments
  });
});
```

## When to use `runCliWithTimeout` vs `runCli`

| Scenario | Helper |
|---|---|
| Daemon command — process never exits on its own | `runCliWithTimeout` |
| Command exits quickly (normal success or error) | `runCli` |

## `runCliWithTimeout` signature (from `e2e/helpers/cli.ts`)

```typescript
runCliWithTimeout(
  args: string[],        // CLI args after the entrypoint
  timeoutMs: number,     // ms to wait before killing the process
  options?: { cwd?: string },
): Promise<CliResult>   // exitCode is -1 when the timeout fired
```

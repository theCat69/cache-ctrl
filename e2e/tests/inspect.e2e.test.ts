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

describe("inspect", () => {
  it("returns ok:true and full entry content for known external subject", async () => {
    const result = await runCli(["inspect", "external", "sample"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: {
        subject: string;
        description: string;
        fetched_at: string;
        sources: unknown[];
      };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.subject).toBe("sample");
    expect(output.value.description).toBeTruthy();
    expect(output.value.fetched_at).toBeTruthy();
    expect(Array.isArray(output.value.sources)).toBe(true);
  });

  it("returns ok:false with FILE_NOT_FOUND for unknown subject", async () => {
    const result = await runCli(["inspect", "external", "does-not-exist"], { cwd: repo.dir });
    expect(result.exitCode).toBe(1);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("FILE_NOT_FOUND");
  });

  it("returns ok:false with INVALID_ARGS for invalid agent", async () => {
    const result = await runCli(["inspect", "badagent", "sample"], { cwd: repo.dir });
    expect(result.exitCode).toBe(2);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("INVALID_ARGS");
  });

  it("missing subject arg exits with code 2", async () => {
    const result = await runCli(["inspect", "external"], { cwd: repo.dir });
    expect(result.exitCode).toBe(2);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("INVALID_ARGS");
  });

  it("missing both agent and subject exits with code 2", async () => {
    const result = await runCli(["inspect"], { cwd: repo.dir });
    expect(result.exitCode).toBe(2);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("INVALID_ARGS");
  });
});

describe("inspect local — tracked_files stripping and --filter", () => {
  it("inspect local context never returns tracked_files", async () => {
    // Write a local entry with tracked_files + facts
    const entry = {
      topic: "filter test",
      description: "inspect filter e2e",
      tracked_files: [{ path: "src/file-a.ts" }, { path: "src/file-b.ts" }],
      facts: {
        "src/file-a.ts": ["exports fetchUser"],
        "src/file-b.ts": ["exports validateInput"],
      },
    };
    const writeResult = await runCli(["write", "local", "--data", JSON.stringify(entry)], {
      cwd: repo.dir,
    });
    expect(writeResult.exitCode).toBe(0);

    const result = await runCli(["inspect", "local", "context"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{ ok: boolean; value: Record<string, unknown> }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.tracked_files).toBeUndefined();
    expect(output.value.facts).toBeDefined();
  });

  it("inspect local context --filter returns only matching facts paths", async () => {
    const entry = {
      topic: "filter test",
      description: "inspect filter e2e",
      tracked_files: [{ path: "src/file-a.ts" }, { path: "src/file-b.ts" }],
      facts: {
        "src/file-a.ts": ["exports fetchUser"],
        "src/file-b.ts": ["exports validateInput"],
      },
    };
    const writeResult = await runCli(["write", "local", "--data", JSON.stringify(entry)], {
      cwd: repo.dir,
    });
    expect(writeResult.exitCode).toBe(0);

    const result = await runCli(["inspect", "local", "context", "--filter", "file-a"], {
      cwd: repo.dir,
    });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: { facts: Record<string, string[]> };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    const facts = output.value.facts;
    expect(facts["src/file-a.ts"]).toEqual(["exports fetchUser"]);
    expect(facts["src/file-b.ts"]).toBeUndefined();
  });

  it("inspect local context --filter with comma-separated keywords (OR logic)", async () => {
    const entry = {
      topic: "filter test",
      description: "multi-keyword filter e2e",
      tracked_files: [{ path: "src/file-a.ts" }, { path: "src/file-b.ts" }],
      facts: {
        "src/file-a.ts": ["exports fetchUser"],
        "src/file-b.ts": ["exports validateInput"],
      },
    };
    await runCli(["write", "local", "--data", JSON.stringify(entry)], { cwd: repo.dir });

    const result = await runCli(
      ["inspect", "local", "context", "--filter", "file-a,file-b"],
      { cwd: repo.dir },
    );
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: { facts: Record<string, string[]> };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    const facts = output.value.facts;
    expect(facts["src/file-a.ts"]).toBeDefined();
    expect(facts["src/file-b.ts"]).toBeDefined();
  });
});

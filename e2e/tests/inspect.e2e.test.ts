import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { runCli, parseJsonOutput } from "../helpers/cli.ts";
import { createTestRepo, type TestRepo } from "../helpers/repo.ts";

let repo: TestRepo;

beforeEach(async () => {
  repo = await createTestRepo();
});

afterEach(async () => {
  await repo.cleanup();
});

describe("inspect-external", () => {
  it("returns ok:true and full entry content for known external subject", async () => {
    const result = await runCli(["inspect-external", "sample"], { cwd: repo.dir });
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
    const result = await runCli(["inspect-external", "does-not-exist"], { cwd: repo.dir });
    expect(result.exitCode).toBe(1);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("FILE_NOT_FOUND");
  });

  it("missing subject arg exits with code 2", async () => {
    const result = await runCli(["inspect-external"], { cwd: repo.dir });
    expect(result.exitCode).toBe(2);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("INVALID_ARGS");
  });

  it("missing both command args exits with code 2", async () => {
    const result = await runCli(["inspect-external"], { cwd: repo.dir });
    expect(result.exitCode).toBe(2);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("INVALID_ARGS");
  });
});

describe("inspect-local — tracked_files stripping and --filter", () => {
  it("returns FILE_NOT_FOUND when local context.json is missing", async () => {
    await rm(join(repo.dir, ".ai", "local-context-gatherer_cache", "context.json"));

    const result = await runCli(["inspect-local"], { cwd: repo.dir });
    expect(result.exitCode).toBe(1);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("FILE_NOT_FOUND");
  });

  it("inspect local context never returns tracked_files", async () => {
    // Write a local entry with tracked_files + facts
    const entry = {
      topic: "filter test",
      description: "inspect filter e2e",
      tracked_files: [{ path: "src/file-a.ts" }, { path: "src/file-b.ts" }],
      facts: {
        "src/file-a.ts": { facts: ["exports fetchUser"] },
        "src/file-b.ts": { facts: ["exports validateInput"] },
      },
    };
    const writeResult = await runCli(["write-local", "--data", JSON.stringify(entry)], {
      cwd: repo.dir,
    });
    expect(writeResult.exitCode).toBe(0);

    const result = await runCli(["inspect-local"], { cwd: repo.dir });
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
        "src/file-a.ts": { facts: ["exports fetchUser"] },
        "src/file-b.ts": { facts: ["exports validateInput"] },
      },
    };
    const writeResult = await runCli(["write-local", "--data", JSON.stringify(entry)], {
      cwd: repo.dir,
    });
    expect(writeResult.exitCode).toBe(0);

    const result = await runCli(["inspect-local", "--filter", "file-a"], {
      cwd: repo.dir,
    });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: { facts: Record<string, { facts?: string[] }> };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    const facts = output.value.facts;
    expect(facts["src/file-a.ts"]?.facts).toEqual(["exports fetchUser"]);
    expect(facts["src/file-b.ts"]).toBeUndefined();
  });

  it("inspect local context --filter with comma-separated keywords (OR logic)", async () => {
    const entry = {
      topic: "filter test",
      description: "multi-keyword filter e2e",
      tracked_files: [{ path: "src/file-a.ts" }, { path: "src/file-b.ts" }],
      facts: {
        "src/file-a.ts": { facts: ["exports fetchUser"] },
        "src/file-b.ts": { facts: ["exports validateInput"] },
      },
    };
    await runCli(["write-local", "--data", JSON.stringify(entry)], { cwd: repo.dir });

    const result = await runCli(["inspect-local", "--filter", "file-a,file-b"], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: { facts: Record<string, { facts?: string[] }> };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    const facts = output.value.facts;
    expect(facts["src/file-a.ts"]).toBeDefined();
    expect(facts["src/file-b.ts"]).toBeDefined();
  });
});

describe("inspect-local — --folder and --search-facts filters", () => {
  it("--folder src returns only files under src/ (ok: true, all facts keys start with 'src/')", async () => {
    const entry = {
      topic: "folder filter e2e",
      description: "test folder filter",
      tracked_files: [
        { path: "src/file-a.ts" },
        { path: "src/file-b.ts" },
        { path: "docs/README.md" },
      ],
      facts: {
        "src/file-a.ts": { facts: ["Exports fileA"] },
        "src/file-b.ts": { facts: ["Exports fileB"] },
        "docs/README.md": { facts: ["project documentation"] },
      },
    };
    const writeResult = await runCli(["write-local", "--data", JSON.stringify(entry)], {
      cwd: repo.dir,
    });
    expect(writeResult.exitCode).toBe(0);

    const result = await runCli(["inspect-local", "--folder", "src"], {
      cwd: repo.dir,
    });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: { facts: Record<string, { facts?: string[] }> };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    const facts = output.value.facts;
    for (const key of Object.keys(facts)) {
      expect(key.startsWith("src/")).toBe(true);
    }
    expect(facts["src/file-a.ts"]).toBeDefined();
    expect(facts["src/file-b.ts"]).toBeDefined();
    expect(facts["docs/README.md"]).toBeUndefined();
  });

  it("--search-facts returns file whose fact contains the search term", async () => {
    const entry = {
      topic: "search-facts e2e",
      description: "test search-facts filter",
      tracked_files: [
        { path: "src/file-a.ts" },
        { path: "src/file-b.ts" },
      ],
      facts: {
        "src/file-a.ts": {
          facts: ["Exports fileA", "uses someterm pattern"],
        },
        "src/file-b.ts": {
          facts: ["Exports fileB", "handles errors gracefully"],
        },
      },
    };
    const writeResult = await runCli(["write-local", "--data", JSON.stringify(entry)], {
      cwd: repo.dir,
    });
    expect(writeResult.exitCode).toBe(0);

    const result = await runCli(
      ["inspect-local", "--search-facts", "someterm"],
      { cwd: repo.dir },
    );
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: { facts: Record<string, { facts?: string[] }> };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    const facts = output.value.facts;
    expect(facts["src/file-a.ts"]).toBeDefined();
    expect(facts["src/file-b.ts"]).toBeUndefined();
  });

  it("--folder + --filter + --search-facts are AND-ed: intersection of all three filters", async () => {
    const entry = {
      topic: "three-way filter e2e",
      description: "test all three filters combined",
      tracked_files: [
        { path: "src/file-a.ts" },
        { path: "src/file-b.ts" },
      ],
      facts: {
        "src/file-a.ts": {
          facts: ["Exports fileA", "uses advisory locking"],
        },
        "src/file-b.ts": {
          facts: ["Exports fileB", "reads all entries"],
        },
      },
    };
    const writeResult = await runCli(["write-local", "--data", JSON.stringify(entry)], {
      cwd: repo.dir,
    });
    expect(writeResult.exitCode).toBe(0);

    // --folder src: keeps both files
    // --filter file-a: keeps src/file-a.ts
    // --search-facts advisory: also matches src/file-a.ts
    const result = await runCli(
      ["inspect-local", "--folder", "src", "--filter", "file-a", "--search-facts", "advisory"],
      { cwd: repo.dir },
    );
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: { facts: Record<string, { facts?: string[] }> };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    const facts = output.value.facts;
    expect(facts["src/file-a.ts"]).toBeDefined();
    expect(facts["src/file-b.ts"]).toBeUndefined();
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";

import { runCli, parseJsonOutput } from "../helpers/cli.ts";
import { createTestRepo, type TestRepo } from "../helpers/repo.ts";

let repo: TestRepo;
let configTempDir: string | undefined;

beforeEach(async () => {
  repo = await createTestRepo();
  configTempDir = undefined;
});

afterEach(async () => {
  try {
    if (configTempDir !== undefined) {
      await rm(configTempDir, { recursive: true, force: true });
    }
  } finally {
    await repo.cleanup();
  }
});

describe("install", () => {
  it("install --config-dir <home-subdir> exits 0 and returns installed skill paths", async () => {
    configTempDir = await mkdtemp(join(os.homedir(), ".tmp-cc-e2e-"));

    const result = await runCli(["install", "--config-dir", configTempDir], { cwd: repo.dir });
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: {
        skillPaths: string[];
        configDir: string;
      };
    }>(result.stdout);
    expect(output.ok).toBe(true);

    const expectedSkillPaths = [
      join(resolve(configTempDir), "skills", "cache-ctrl-external", "SKILL.md"),
      join(resolve(configTempDir), "skills", "cache-ctrl-local", "SKILL.md"),
      join(resolve(configTempDir), "skills", "cache-ctrl-caller", "SKILL.md"),
    ];
    expect(output.value.skillPaths).toEqual(expect.arrayContaining(expectedSkillPaths));

    expect(output.value.configDir).toBe(resolve(configTempDir));
  });

  it("install --config-dir /tmp/no-install exits 1 with INVALID_ARGS", async () => {
    const result = await runCli(["install", "--config-dir", "/tmp/no-install"], { cwd: repo.dir });
    expect(result.exitCode).toBe(1);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("INVALID_ARGS");
  });

  it("rejects config-dir prefix collision outside home with INVALID_ARGS", async () => {
    const collidingPath = join(`${os.homedir()}x`, "evil");

    const result = await runCli(["install", "--config-dir", collidingPath], { cwd: repo.dir });
    expect(result.exitCode).toBe(1);

    const errorOutput = parseJsonOutput<{ ok: boolean; code: string }>(result.stderr);
    expect(errorOutput.ok).toBe(false);
    expect(errorOutput.code).toBe("INVALID_ARGS");
  });
});

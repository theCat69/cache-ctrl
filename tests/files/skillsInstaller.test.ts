import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const thisDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(thisDir, "../..");

describe("cache-ctrl local gatherer skill contract", () => {
  it("enforces write-local after reading changed/new files", async () => {
    const skillPath = join(repoRoot, "skills", "cache-ctrl-local", "SKILL.md");
    const skillText = await readFile(skillPath, "utf8");

    expect(skillText).toContain("Every invocation that reads any file MUST call `cache-ctrl write-local --data '<json>'` before returning.");
    expect(skillText).toContain("Write-or-fail");
  });
});

describe("cache-ctrl caller orchestration contract", () => {
  it("requires changed/new file scans to trigger write-local automatically", async () => {
    const skillPath = join(repoRoot, "skills", "cache-ctrl-caller", "SKILL.md");
    const skillText = await readFile(skillPath, "utf8");

    expect(skillText).toContain("status: \"changed\"");
    expect(skillText).toContain("must write updated facts with `cache-ctrl write-local --data '<json>'` before returning");
    expect(skillText).toContain("do not wait for an explicit user request to write");
  });
});

import { describe, it, expect } from "vitest";

import { runCli, parseJsonOutput } from "../helpers/cli.ts";

describe("version", () => {
  it("exits 0 and returns package semver", async () => {
    const result = await runCli(["version"]);
    expect(result.exitCode).toBe(0);

    const output = parseJsonOutput<{
      ok: boolean;
      value: { version: string };
    }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.value.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  });
});

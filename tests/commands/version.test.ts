import { describe, expect, it } from "vitest";

import packageJson from "../../package.json" with { type: "json" };

import { versionCommand } from "../../src/commands/version.js";

describe("versionCommand", () => {
  it("returns ok=true with the package version", () => {
    const result = versionCommand({});

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.version).toBe(packageJson.version);
    expect(result.value.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

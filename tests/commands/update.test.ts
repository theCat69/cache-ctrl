import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { homedirMock } = vi.hoisted(() => ({
  homedirMock: vi.fn(() => "/home/tester"),
}));

vi.mock("node:os", () => ({
  default: {
    homedir: homedirMock,
  },
}));

import { updateCommand } from "../../src/commands/update.js";
import { ErrorCode } from "../../src/types/result.js";

function createSpawnResult(exitCode: number, stderrText: string, stdoutText = ""): { exitCode: number; stdout: Uint8Array; stderr: Uint8Array } {
  const encoder = new TextEncoder();
  return {
    exitCode,
    stdout: encoder.encode(stdoutText),
    stderr: encoder.encode(stderrText),
  };
}

describe("updateCommand", () => {
  let spawnSyncMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    spawnSyncMock = vi.fn();
    vi.stubGlobal("Bun", { spawnSync: spawnSyncMock });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns packageUpdated=true and empty warnings when npm and install succeed", async () => {
    const installStdout = JSON.stringify({
      toolPath: "/cfg/opencode/tools/cache_ctrl.ts",
      skillPaths: [
        "/cfg/opencode/skills/cache-ctrl-external/SKILL.md",
        "/cfg/opencode/skills/cache-ctrl-local/SKILL.md",
      ],
      configDir: "/home/tester/.config/opencode",
    });
    spawnSyncMock
      .mockReturnValueOnce(createSpawnResult(0, ""))
      .mockReturnValueOnce(createSpawnResult(0, "", installStdout));

    const result = await updateCommand({});

    expect(spawnSyncMock).toHaveBeenCalledWith(["npm", "install", "-g", "@thecat69/cache-ctrl@latest"]);
    expect(spawnSyncMock).toHaveBeenNthCalledWith(
      2,
      [process.execPath, expect.stringMatching(/src\/index\.ts$/), "install", "--config-dir", "/home/tester/.config/opencode"],
      { stdout: "pipe", stderr: "pipe" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.packageUpdated).toBe(true);
    expect(result.value.warnings).toEqual([]);
    expect(result.value.installedPaths).toEqual([
      "/cfg/opencode/tools/cache_ctrl.ts",
      "/cfg/opencode/skills/cache-ctrl-external/SKILL.md",
      "/cfg/opencode/skills/cache-ctrl-local/SKILL.md",
    ]);
  });

  it("continues when npm fails and returns warning text", async () => {
    const installStdout = JSON.stringify({
      toolPath: "/cfg/opencode/tools/cache_ctrl.ts",
      skillPaths: ["/cfg/opencode/skills/cache-ctrl-caller/SKILL.md"],
      configDir: "/home/tester/.config/opencode",
    });
    spawnSyncMock
      .mockReturnValueOnce(createSpawnResult(1, "npm network error"))
      .mockReturnValueOnce(createSpawnResult(0, "", installStdout));

    const result = await updateCommand({});

    expect(spawnSyncMock).toHaveBeenCalledTimes(2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.packageUpdated).toBe(false);
    expect(result.value.warnings).toEqual(["npm network error"]);
    expect(result.value.installedPaths).toContain("/cfg/opencode/tools/cache_ctrl.ts");
  });

  it("returns FILE_WRITE_ERROR when install subprocess fails", async () => {
    spawnSyncMock
      .mockReturnValueOnce(createSpawnResult(0, ""))
      .mockReturnValueOnce(createSpawnResult(1, "cannot write tool file"));

    const result = await updateCommand({});

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe(ErrorCode.FILE_WRITE_ERROR);
    expect(result.error).toContain("cannot write tool file");
  });

  it("returns warning when install subprocess output is not valid JSON", async () => {
    spawnSyncMock
      .mockReturnValueOnce(createSpawnResult(0, ""))
      .mockReturnValueOnce(createSpawnResult(0, "", "not json"));

    const result = await updateCommand({});

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.installedPaths).toEqual([]);
    expect(result.value.warnings).toEqual([
      "cache-ctrl install succeeded but returned unreadable output; installed paths unavailable",
    ]);
    expect(result.value.warnings[0]).toContain("unreadable output");
  });

  it("returns INVALID_ARGS when configDir resolves outside home directory", async () => {
    const result = await updateCommand({ configDir: "../../etc" });

    expect(spawnSyncMock).not.toHaveBeenCalled();

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe(ErrorCode.INVALID_ARGS);
    expect(result.error).toContain("--config-dir must be within the user home directory");
  });
});

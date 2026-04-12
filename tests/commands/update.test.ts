import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { installCommandMock } = vi.hoisted(() => ({
  installCommandMock: vi.fn(),
}));

const { homedirMock } = vi.hoisted(() => ({
  homedirMock: vi.fn(() => "/home/tester"),
}));

vi.mock("../../src/commands/install.js", () => ({
  installCommand: installCommandMock,
}));

vi.mock("node:os", () => ({
  default: {
    homedir: homedirMock,
  },
}));

import { updateCommand } from "../../src/commands/update.js";
import { ErrorCode } from "../../src/types/result.js";

function createSpawnResult(exitCode: number, stderrText: string): { exitCode: number; stdout: Uint8Array; stderr: Uint8Array } {
  const encoder = new TextEncoder();
  return {
    exitCode,
    stdout: encoder.encode(""),
    stderr: encoder.encode(stderrText),
  };
}

describe("updateCommand", () => {
  const globalObject = globalThis as Record<string, unknown>;
  let originalBun: unknown;
  let spawnSyncMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    spawnSyncMock = vi.fn(() => createSpawnResult(0, ""));
    originalBun = globalObject.Bun;
    globalObject.Bun = { spawnSync: spawnSyncMock };

    installCommandMock.mockResolvedValue({
      ok: true,
      value: {
        toolPath: "/cfg/opencode/tools/cache_ctrl.ts",
        skillPaths: [
          "/cfg/opencode/skills/cache-ctrl-external/SKILL.md",
          "/cfg/opencode/skills/cache-ctrl-local/SKILL.md",
        ],
        configDir: "/cfg/opencode",
      },
    });
  });

  afterEach(() => {
    globalObject.Bun = originalBun;
  });

  it("returns packageUpdated=true and empty warnings when npm and install succeed", async () => {
    const result = await updateCommand({ configDir: "/home/tester/.config/opencode" });

    expect(spawnSyncMock).toHaveBeenCalledWith(["npm", "install", "-g", "@thecat69/cache-ctrl@latest"]);
    expect(installCommandMock).toHaveBeenCalledWith({ configDir: "/home/tester/.config/opencode" });

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
    spawnSyncMock.mockReturnValueOnce(createSpawnResult(1, "npm network error"));

    const result = await updateCommand({});

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.packageUpdated).toBe(false);
    expect(result.value.warnings).toEqual(["npm network error"]);
    expect(result.value.installedPaths).toContain("/cfg/opencode/tools/cache_ctrl.ts");
  });

  it("propagates installCommand error code when installCommand fails", async () => {
    installCommandMock.mockResolvedValueOnce({
      ok: false,
      error: "cannot write tool file",
      code: ErrorCode.FILE_WRITE_ERROR,
    });

    const result = await updateCommand({});

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe(ErrorCode.FILE_WRITE_ERROR);
    expect(result.error).toBe("cannot write tool file");
  });

  it("returns INVALID_ARGS when configDir resolves outside home directory", async () => {
    const result = await updateCommand({ configDir: "../../etc" });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe(ErrorCode.INVALID_ARGS);
    expect(result.error).toContain("--config-dir must be within the user home directory");
  });
});

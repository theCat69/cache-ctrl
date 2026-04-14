import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  resolveOpenCodeConfigDirMock,
  unlinkMock,
  readdirMock,
  rmMock,
  homedirMock,
} = vi.hoisted(() => ({
  resolveOpenCodeConfigDirMock: vi.fn(),
  unlinkMock: vi.fn(),
  readdirMock: vi.fn(),
  rmMock: vi.fn(),
  homedirMock: vi.fn(() => "/home/tester"),
}));

vi.mock("../../src/files/openCodeInstaller.js", () => ({
  resolveOpenCodeConfigDir: resolveOpenCodeConfigDirMock,
}));

vi.mock("node:fs/promises", () => ({
  unlink: unlinkMock,
  readdir: readdirMock,
  rm: rmMock,
}));

vi.mock("node:os", () => ({
  homedir: homedirMock,
  default: {
    homedir: homedirMock,
  },
}));

import { uninstallCommand } from "../../src/commands/uninstall.js";
import { ErrorCode } from "../../src/types/result.js";

function createSpawnResult(exitCode: number, stderrText: string): { exitCode: number; stdout: Uint8Array; stderr: Uint8Array } {
  const encoder = new TextEncoder();
  return {
    exitCode,
    stdout: encoder.encode(""),
    stderr: encoder.encode(stderrText),
  };
}

function enoentError(message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = "ENOENT";
  return err;
}

describe("uninstallCommand", () => {
  const globalObject = globalThis as Record<string, unknown>;
  let originalBun: unknown;
  let spawnSyncMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    resolveOpenCodeConfigDirMock.mockReturnValue("/cfg/opencode");
    unlinkMock.mockResolvedValue(undefined);
    readdirMock.mockResolvedValue([
      { name: "cache-ctrl-caller", isDirectory: () => true },
      { name: "cache-ctrl-local", isDirectory: () => true },
      { name: "other-skill", isDirectory: () => true },
    ]);
    rmMock.mockResolvedValue(undefined);
    homedirMock.mockReturnValue("/home/tester");

    spawnSyncMock = vi.fn(() => createSpawnResult(0, ""));
    originalBun = globalObject.Bun;
    globalObject.Bun = { spawnSync: spawnSyncMock };
  });

  afterEach(() => {
    globalObject.Bun = originalBun;
  });

  it("removes managed files and returns packageUninstalled=true on happy path", async () => {
    const result = await uninstallCommand({ configDir: "/home/tester/.config/opencode" });

    expect(resolveOpenCodeConfigDirMock).toHaveBeenCalledWith("/home/tester/.config/opencode");
    expect(spawnSyncMock).toHaveBeenCalledWith(["npm", "uninstall", "-g", "@thecat69/cache-ctrl"]);
    expect(rmMock).toHaveBeenCalledWith("/cfg/opencode/skills/cache-ctrl-caller", { recursive: true });
    expect(rmMock).toHaveBeenCalledWith("/cfg/opencode/skills/cache-ctrl-local", { recursive: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.packageUninstalled).toBe(true);
    expect(result.value.warnings).toEqual([]);
    expect(result.value.removed).toEqual([
      "/cfg/opencode/tools/cache_ctrl.ts",
      "/cfg/opencode/skills/cache-ctrl-caller",
      "/cfg/opencode/skills/cache-ctrl-local",
      "/home/tester/.local/bin/cache-ctrl",
    ]);
  });

  it("returns ok=true with warnings when tool file is missing and npm uninstall fails", async () => {
    unlinkMock.mockImplementation(async (targetPath: string) => {
      if (targetPath === "/cfg/opencode/tools/cache_ctrl.ts") {
        throw enoentError("not found");
      }
      return undefined;
    });
    readdirMock.mockResolvedValue([]);
    spawnSyncMock.mockReturnValueOnce(createSpawnResult(1, "npm uninstall failed"));

    const result = await uninstallCommand({});

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.packageUninstalled).toBe(false);
    expect(result.value.removed).toEqual(["/home/tester/.local/bin/cache-ctrl"]);
    expect(result.value.warnings).toContain("Tool file not found: /cfg/opencode/tools/cache_ctrl.ts");
    expect(result.value.warnings).toContain("npm uninstall failed");
  });

  it("returns UNKNOWN when fs operation throws a non-ENOENT error", async () => {
    readdirMock.mockRejectedValueOnce(new Error("EACCES: permission denied"));

    const result = await uninstallCommand({});

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe(ErrorCode.UNKNOWN);
    expect(result.error).toContain("permission denied");
  });

  it("returns INVALID_ARGS when configDir is outside home directory", async () => {
    const result = await uninstallCommand({ configDir: "/etc" });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe(ErrorCode.INVALID_ARGS);
    expect(result.error).toContain("--config-dir must be within the user home directory");
  });

  it("accepts configDir exactly equal to home directory", async () => {
    resolveOpenCodeConfigDirMock.mockReturnValue("/home/tester");
    readdirMock.mockResolvedValue([]);

    const result = await uninstallCommand({ configDir: "/home/tester" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(resolveOpenCodeConfigDirMock).toHaveBeenCalledWith("/home/tester");
    expect(result.value.packageUninstalled).toBe(true);
    expect(result.value.warnings).toEqual([]);
    expect(result.value.removed).toContain("/home/tester/tools/cache_ctrl.ts");
  });
});

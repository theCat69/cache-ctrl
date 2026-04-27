import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";

const { mkdirMock, copyFileMock, realpathMock, homedirMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  copyFileMock: vi.fn(),
  realpathMock: vi.fn(async (inputPath: string) => inputPath),
  homedirMock: vi.fn(() => "/home/tester"),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mkdirMock,
  copyFile: copyFileMock,
  realpath: realpathMock,
}));

vi.mock("node:os", () => ({
  homedir: homedirMock,
  default: {
    homedir: homedirMock,
  },
}));

import { installCommand } from "../../src/commands/install.js";
import {
  isPathWithinDirectory,
  installSkills,
  resolveOpenCodeConfigDir,
} from "../../src/files/skillsInstaller.js";
import { ErrorCode } from "../../src/types/result.js";

describe("installCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mkdirMock.mockResolvedValue(undefined);
    copyFileMock.mockResolvedValue(undefined);
    realpathMock.mockImplementation(async (inputPath: string) => inputPath);
    homedirMock.mockReturnValue("/home/tester");
  });

  it("resolves config dir to ~/.config/opencode via homedir", () => {
    expect(resolveOpenCodeConfigDir()).toBe("/home/tester/.config/opencode");
  });

  it("uses explicit --config-dir override", () => {
    expect(resolveOpenCodeConfigDir("/custom/opencode")).toBe("/custom/opencode");
  });

  it("creates skill directories recursively and copies all skills", async () => {
    const result = await installCommand({ configDir: "/home/tester/cfg/opencode" }, "/test/pkg");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.configDir).toBe("/home/tester/cfg/opencode");
    expect(result.value.skillPaths).toEqual([
      "/home/tester/cfg/opencode/skills/cache-ctrl-external/SKILL.md",
      "/home/tester/cfg/opencode/skills/cache-ctrl-local/SKILL.md",
      "/home/tester/cfg/opencode/skills/cache-ctrl-caller/SKILL.md",
    ]);

    expect(mkdirMock).toHaveBeenCalledWith("/home/tester/cfg/opencode/skills/cache-ctrl-external", {
      recursive: true,
      mode: 0o755,
    });
    expect(mkdirMock).toHaveBeenCalledWith("/home/tester/cfg/opencode/skills/cache-ctrl-local", {
      recursive: true,
      mode: 0o755,
    });
    expect(mkdirMock).toHaveBeenCalledWith("/home/tester/cfg/opencode/skills/cache-ctrl-caller", {
      recursive: true,
      mode: 0o755,
    });

    expect(copyFileMock).toHaveBeenCalledWith(
      "/test/pkg/skills/cache-ctrl-external/SKILL.md",
      "/home/tester/cfg/opencode/skills/cache-ctrl-external/SKILL.md",
    );
    expect(copyFileMock).toHaveBeenCalledWith(
      "/test/pkg/skills/cache-ctrl-local/SKILL.md",
      "/home/tester/cfg/opencode/skills/cache-ctrl-local/SKILL.md",
    );
    expect(copyFileMock).toHaveBeenCalledWith(
      "/test/pkg/skills/cache-ctrl-caller/SKILL.md",
      "/home/tester/cfg/opencode/skills/cache-ctrl-caller/SKILL.md",
    );
  });

  it("returns FILE_WRITE_ERROR when mkdir throws", async () => {
    mkdirMock.mockRejectedValueOnce(new Error("EPERM: permission denied"));

    const result = await installCommand({ configDir: "/home/tester/cfg/opencode" }, "/test/pkg");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.FILE_WRITE_ERROR);
  });

  it("returns FILE_WRITE_ERROR when copyFile throws", async () => {
    copyFileMock.mockRejectedValueOnce(new Error("ENOSPC: no space left on device"));

    const result = await installCommand({ configDir: "/home/tester/cfg/opencode" }, "/test/pkg");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.FILE_WRITE_ERROR);
  });

  it("is idempotent: second run overwrites without error", async () => {
    const first = await installCommand({ configDir: "/home/tester/cfg/opencode" }, "/test/pkg");
    const second = await installCommand({ configDir: "/home/tester/cfg/opencode" }, "/test/pkg");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(copyFileMock).toHaveBeenCalledTimes(6);
  });

  it("installSkills returns installed skill paths", async () => {
    const result = await installSkills("/home/tester/cfg/opencode", "/pkg/root");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.configDir).toBe("/home/tester/cfg/opencode");
    expect(result.value.skillPaths).toEqual([
      "/home/tester/cfg/opencode/skills/cache-ctrl-external/SKILL.md",
      "/home/tester/cfg/opencode/skills/cache-ctrl-local/SKILL.md",
      "/home/tester/cfg/opencode/skills/cache-ctrl-caller/SKILL.md",
    ]);
  });

  it("returns INVALID_ARGS when configDir is outside home directory", async () => {
    const result = await installSkills("/etc/opencode", "/pkg/root");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.INVALID_ARGS);
    expect(result.error).toContain("Config directory must be within home directory");
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(copyFileMock).not.toHaveBeenCalled();
  });

  it("rejects installSkills when canonical config path escapes home", async () => {
    realpathMock.mockImplementation(async (inputPath: string) => {
      if (inputPath === "/home/tester") return "/home/tester";
      if (inputPath === "/home/tester/.config/opencode") {
        throw Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
      }
      if (inputPath === "/home/tester/.config") return "/etc";
      return inputPath;
    });

    const result = await installSkills("/home/tester/.config/opencode", "/pkg/root");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.INVALID_ARGS);
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(copyFileMock).not.toHaveBeenCalled();
  });

  it("returns FILE_WRITE_ERROR when realpath fails with non-missing-path error", async () => {
    realpathMock.mockImplementation(async (inputPath: string) => {
      if (inputPath === "/home/tester") return "/home/tester";
      if (inputPath === "/home/tester/.config/opencode") {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      }
      return inputPath;
    });

    const result = await installSkills("/home/tester/.config/opencode", "/pkg/root");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.FILE_WRITE_ERROR);
    expect(result.error).toContain("permission denied");
    expect(mkdirMock).not.toHaveBeenCalled();
    expect(copyFileMock).not.toHaveBeenCalled();
  });

  it("accepts Windows config path within home directory", () => {
    const homeDirectory = "C:\\Users\\Alice";
    const configDirectory = "c:\\users\\alice\\AppData\\Roaming\\opencode";

    const isWithinHome = isPathWithinDirectory(configDirectory, homeDirectory, path.win32, "win32");

    expect(isWithinHome).toBe(true);
  });

  it("rejects Windows prefix collision outside home directory", () => {
    const homeDirectory = "C:\\Users\\Alice";
    const collidingDirectory = "C:\\Users\\Alicex\\opencode";

    const isWithinHome = isPathWithinDirectory(collidingDirectory, homeDirectory, path.win32, "win32");

    expect(isWithinHome).toBe(false);
  });

  it("rejects Windows config path on a different drive", () => {
    const homeDirectory = "C:\\Users\\Alice";
    const crossDriveDirectory = "D:\\opencode";

    const isWithinHome = isPathWithinDirectory(crossDriveDirectory, homeDirectory, path.win32, "win32");

    expect(isWithinHome).toBe(false);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mkdirMock, writeFileMock, copyFileMock, homedirMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  writeFileMock: vi.fn(),
  copyFileMock: vi.fn(),
  homedirMock: vi.fn(() => "/home/tester"),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mkdirMock,
  writeFile: writeFileMock,
  copyFile: copyFileMock,
}));

vi.mock("node:os", () => ({
  homedir: homedirMock,
  default: {
    homedir: homedirMock,
  },
}));

import { installCommand } from "../../src/commands/install.js";
import {
  buildToolWrapperContent,
  installOpenCodeIntegration,
  resolveOpenCodeConfigDir,
} from "../../src/files/openCodeInstaller.js";
import { ErrorCode } from "../../src/types/result.js";

describe("installCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    copyFileMock.mockResolvedValue(undefined);
    homedirMock.mockReturnValue("/home/tester");
  });

  it("resolves config dir to ~/.config/opencode via homedir", () => {
    expect(resolveOpenCodeConfigDir()).toBe("/home/tester/.config/opencode");
  });

  it("uses explicit --config-dir override", () => {
    expect(resolveOpenCodeConfigDir("/custom/opencode")).toBe("/custom/opencode");
  });

  it("generates wrapper content with normalized forward slashes", () => {
    const wrapper = buildToolWrapperContent("C:\\Program Files\\cache-ctrl");
    expect(wrapper).toContain('export * from "C:/Program Files/cache-ctrl/cache_ctrl.ts";');
  });

  it("creates directories recursively, writes wrapper, and copies all skills", async () => {
    const result = await installCommand({ configDir: "/cfg/opencode" }, "/test/pkg");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.configDir).toBe("/cfg/opencode");
    expect(result.value.toolPath).toBe("/cfg/opencode/tools/cache_ctrl.ts");
    expect(result.value.skillPaths).toEqual([
      "/cfg/opencode/skills/cache-ctrl-external/SKILL.md",
      "/cfg/opencode/skills/cache-ctrl-local/SKILL.md",
      "/cfg/opencode/skills/cache-ctrl-caller/SKILL.md",
    ]);

    expect(mkdirMock).toHaveBeenCalledWith("/cfg/opencode/tools", { recursive: true, mode: 0o755 });
    expect(mkdirMock).toHaveBeenCalledWith("/cfg/opencode/skills/cache-ctrl-external", { recursive: true, mode: 0o755 });
    expect(mkdirMock).toHaveBeenCalledWith("/cfg/opencode/skills/cache-ctrl-local", { recursive: true, mode: 0o755 });
    expect(mkdirMock).toHaveBeenCalledWith("/cfg/opencode/skills/cache-ctrl-caller", { recursive: true, mode: 0o755 });

    expect(writeFileMock).toHaveBeenCalledWith(
      "/cfg/opencode/tools/cache_ctrl.ts",
      expect.stringContaining('export * from "/test/pkg/cache_ctrl.ts";'),
      { encoding: "utf-8", mode: 0o644 },
    );

    expect(copyFileMock).toHaveBeenCalledWith(
      "/test/pkg/skills/cache-ctrl-external/SKILL.md",
      "/cfg/opencode/skills/cache-ctrl-external/SKILL.md",
    );
    expect(copyFileMock).toHaveBeenCalledWith(
      "/test/pkg/skills/cache-ctrl-local/SKILL.md",
      "/cfg/opencode/skills/cache-ctrl-local/SKILL.md",
    );
    expect(copyFileMock).toHaveBeenCalledWith(
      "/test/pkg/skills/cache-ctrl-caller/SKILL.md",
      "/cfg/opencode/skills/cache-ctrl-caller/SKILL.md",
    );
  });

  it("returns FILE_WRITE_ERROR when writeFile throws", async () => {
    writeFileMock.mockRejectedValueOnce(new Error("disk full"));

    const result = await installCommand({ configDir: "/cfg/opencode" }, "/test/pkg");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.FILE_WRITE_ERROR);
    expect(result.error).toContain("disk full");
  });

  it("returns FILE_WRITE_ERROR when mkdir throws", async () => {
    mkdirMock.mockRejectedValueOnce(new Error("EPERM: permission denied"));

    const result = await installCommand({ configDir: "/cfg/opencode" }, "/test/pkg");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.FILE_WRITE_ERROR);
  });

  it("returns FILE_WRITE_ERROR when copyFile throws", async () => {
    copyFileMock.mockRejectedValueOnce(new Error("ENOSPC: no space left on device"));

    const result = await installCommand({ configDir: "/cfg/opencode" }, "/test/pkg");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ErrorCode.FILE_WRITE_ERROR);
  });

  it("is idempotent: second run overwrites without error", async () => {
    const first = await installCommand({ configDir: "/cfg/opencode" }, "/test/pkg");
    const second = await installCommand({ configDir: "/cfg/opencode" }, "/test/pkg");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(writeFileMock).toHaveBeenCalledTimes(2);
    expect(copyFileMock).toHaveBeenCalledTimes(6);
  });

  it("installOpenCodeIntegration writes wrapper and returns all installed paths", async () => {
    const result = await installOpenCodeIntegration("/cfg/opencode", "/pkg/root");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.toolPath).toBe("/cfg/opencode/tools/cache_ctrl.ts");
    expect(result.value.configDir).toBe("/cfg/opencode");
    expect(result.value.skillPaths).toEqual([
      "/cfg/opencode/skills/cache-ctrl-external/SKILL.md",
      "/cfg/opencode/skills/cache-ctrl-local/SKILL.md",
      "/cfg/opencode/skills/cache-ctrl-caller/SKILL.md",
    ]);

    expect(writeFileMock).toHaveBeenCalledWith(
      "/cfg/opencode/tools/cache_ctrl.ts",
      expect.stringContaining('export * from "/pkg/root/cache_ctrl.ts";'),
      { encoding: "utf-8", mode: 0o644 },
    );
  });
});

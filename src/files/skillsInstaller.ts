import { copyFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { InstallResult } from "../types/commands.js";
import { ErrorCode, type Result } from "../types/result.js";
import { toUnknownResult } from "../errors.js";

const SKILL_NAMES = ["cache-ctrl-external", "cache-ctrl-local", "cache-ctrl-caller"] as const;

/**
 * Resolves the OpenCode configuration directory.
 */
export function resolveOpenCodeConfigDir(overrideDir?: string): string {
  if (overrideDir !== undefined) {
    return path.resolve(overrideDir);
  }

  return path.join(os.homedir(), ".config", "opencode");
}

/**
 * Installs or refreshes bundled skills in the target OpenCode config directory.
 */
export async function installSkills(configDir: string, packageRoot: string): Promise<Result<InstallResult>> {
  try {
    const resolvedConfigDir = path.resolve(configDir);
    if (!resolvedConfigDir.startsWith(os.homedir())) {
      return {
        ok: false,
        error: `Config directory must be within home directory: ${resolvedConfigDir}`,
        code: ErrorCode.INVALID_ARGS,
      };
    }

    const skillPaths: string[] = [];

    for (const skillName of SKILL_NAMES) {
      const targetSkillDir = path.join(resolvedConfigDir, "skills", skillName);
      const sourceSkillPath = path.join(packageRoot, "skills", skillName, "SKILL.md");
      const targetSkillPath = path.join(targetSkillDir, "SKILL.md");

      await mkdir(targetSkillDir, { recursive: true, mode: 0o755 });
      await copyFile(sourceSkillPath, targetSkillPath);
      skillPaths.push(targetSkillPath);
    }

    return {
      ok: true,
      value: {
        skillPaths,
        configDir: resolvedConfigDir,
      },
    };
  } catch (err) {
    const unknownError = toUnknownResult(err);
    return { ...unknownError, code: ErrorCode.FILE_WRITE_ERROR };
  }
}

import { copyFile, mkdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { InstallResult } from "../types/commands.js";
import { ErrorCode, type Result } from "../types/result.js";
import { toUnknownResult } from "../errors.js";

const SKILL_NAMES = ["cache-ctrl-external", "cache-ctrl-local", "cache-ctrl-caller"] as const;

type PathApi = Pick<typeof path, "resolve" | "normalize" | "relative" | "isAbsolute">;

type FsPathApi = Pick<typeof path, "dirname" | "parse" | "relative" | "resolve">;

function isRecoverableMissingPathError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (!("code" in error)) {
    return false;
  }

  const { code } = error;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Resolves a path and canonicalizes the longest existing prefix via realpath().
 *
 * This makes containment checks symlink-safe for existing path segments while
 * still supporting target paths that do not exist yet.
 */
export async function resolveCanonicalPathForContainment(
  inputPath: string,
  realpathFn: typeof realpath = realpath,
  pathApi: FsPathApi = path,
): Promise<string> {
  const resolvedPath = pathApi.resolve(inputPath);
  const rootPath = pathApi.parse(resolvedPath).root;

  let existingPrefix = resolvedPath;
  while (true) {
    try {
      const canonicalPrefix = await realpathFn(existingPrefix);
      const unresolvedSuffix = pathApi.relative(existingPrefix, resolvedPath);
      return unresolvedSuffix === "" ? canonicalPrefix : pathApi.resolve(canonicalPrefix, unresolvedSuffix);
    } catch (error) {
      if (!isRecoverableMissingPathError(error)) {
        throw error;
      }

      if (existingPrefix === rootPath) {
        return resolvedPath;
      }
      existingPrefix = pathApi.dirname(existingPrefix);
    }
  }
}

/**
 * Returns true when targetPath resolves to parentDir or any of its descendants.
 */
export function isPathWithinDirectory(
  targetPath: string,
  parentDir: string,
  pathApi: PathApi = path,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const normalizeForComparison = (inputPath: string): string => {
    const normalizedPath = pathApi.normalize(pathApi.resolve(inputPath));
    return platform === "win32" ? normalizedPath.toLowerCase() : normalizedPath;
  };

  const normalizedTargetPath = normalizeForComparison(targetPath);
  const normalizedParentDir = normalizeForComparison(parentDir);
  const relativePath = pathApi.relative(normalizedParentDir, normalizedTargetPath);

  return relativePath === "" || (!relativePath.startsWith("..") && !pathApi.isAbsolute(relativePath));
}

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
 *
 * Rejects `configDir` values that resolve outside the user's home directory.
 *
 * Containment is validated against canonical paths (realpath of existing
 * segments), which prevents symlink/prefix bypasses where feasible.
 *
 * @returns `Result<InstallResult>` with `INVALID_ARGS` when `configDir`
 * resolves outside `os.homedir()/`, or `FILE_WRITE_ERROR` when any skill
 * file cannot be written.
 */
export async function installSkills(configDir: string, packageRoot: string): Promise<Result<InstallResult>> {
  try {
    const resolvedConfigDir = path.resolve(configDir);
    const canonicalHomeDir = await resolveCanonicalPathForContainment(os.homedir());
    const canonicalConfigDir = await resolveCanonicalPathForContainment(resolvedConfigDir);

    if (!isPathWithinDirectory(canonicalConfigDir, canonicalHomeDir)) {
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

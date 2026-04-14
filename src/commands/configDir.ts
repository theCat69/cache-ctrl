import { homedir } from "node:os";
import { isAbsolute, resolve, sep } from "node:path";

import { ErrorCode, type CacheError, type Result } from "../types/result.js";

/**
 * Validates that an optional OpenCode config directory resolves inside the user home directory.
 */
export function validateConfigDir(configDir?: string): Result<void, CacheError> {
  if (configDir === undefined) {
    return { ok: true, value: undefined };
  }

  const absoluteConfigDir = isAbsolute(configDir)
    ? resolve(configDir)
    : resolve(process.cwd(), configDir);
  const homeDirectory = homedir();

  if (!absoluteConfigDir.startsWith(homeDirectory + sep) && absoluteConfigDir !== homeDirectory) {
    return {
      ok: false,
      error: `--config-dir must be within the user home directory, got: ${configDir}`,
      code: ErrorCode.INVALID_ARGS,
    };
  }

  return { ok: true, value: undefined };
}

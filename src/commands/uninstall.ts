import { readdir, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveOpenCodeConfigDir } from "../files/openCodeInstaller.js";
import type { UninstallArgs, UninstallResult } from "../types/commands.js";
import { ErrorCode, type Result } from "../types/result.js";
import { validateConfigDir } from "../utils/configDir.js";

const textDecoder = new TextDecoder();
const CACHE_CTRL_SKILL_DIR_PATTERN = /^cache-ctrl-/;

/**
 * Removes cache-ctrl OpenCode integration files and uninstalls the global npm package.
 */
export async function uninstallCommand(args: UninstallArgs): Promise<Result<UninstallResult>> {
  try {
    const configDirValidation = validateConfigDir(args.configDir);
    if (!configDirValidation.ok) return configDirValidation;

    const removed: string[] = [];
    const warnings: string[] = [];
    let packageUninstalled = true;

    const configDir = resolveOpenCodeConfigDir(args.configDir);
    const toolFilePath = path.join(configDir, "tools", "cache_ctrl.ts");
    const skillsDirPath = path.join(configDir, "skills");
    const localBinaryPath = path.join(os.homedir(), ".local", "bin", "cache-ctrl");

    try {
      await unlink(toolFilePath);
      removed.push(toolFilePath);
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        warnings.push(`Tool file not found: ${toolFilePath}`);
      } else {
        throw err;
      }
    }

    try {
      const skillEntries = await readdir(skillsDirPath, { withFileTypes: true });
      for (const skillEntry of skillEntries) {
        if (!skillEntry.isDirectory() || !CACHE_CTRL_SKILL_DIR_PATTERN.test(skillEntry.name)) {
          continue;
        }
        const skillPath = path.join(skillsDirPath, skillEntry.name);
        await rm(skillPath, { recursive: true });
        removed.push(skillPath);
      }
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        warnings.push(`Skills directory not found: ${skillsDirPath}`);
      } else {
        throw err;
      }
    }

    try {
      await unlink(localBinaryPath);
      removed.push(localBinaryPath);
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        warnings.push(`Local binary not found: ${localBinaryPath}`);
      } else {
        throw err;
      }
    }

    const uninstallProcess = Bun.spawnSync(["npm", "uninstall", "-g", "@thecat69/cache-ctrl"]);
    if (uninstallProcess.exitCode !== 0) {
      packageUninstalled = false;
      const npmError = textDecoder.decode(uninstallProcess.stderr);
      warnings.push(npmError.length > 0 ? npmError : "npm uninstall -g @thecat69/cache-ctrl failed");
    }

    return {
      ok: true,
      value: {
        removed,
        packageUninstalled,
        warnings,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: message,
      code: ErrorCode.UNKNOWN,
    };
  }
}

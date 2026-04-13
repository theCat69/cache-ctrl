import type { UpdateArgs, UpdateResult } from "../types/commands.js";
import { ErrorCode, type Result } from "../types/result.js";
import { validateConfigDir } from "../utils/configDir.js";

import { installCommand } from "./install.js";

const textDecoder = new TextDecoder();

/**
 * Updates the globally installed npm package and refreshes OpenCode integration files.
 */
export async function updateCommand(args: UpdateArgs): Promise<Result<UpdateResult>> {
  try {
    const configDirValidation = validateConfigDir(args.configDir);
    if (!configDirValidation.ok) return configDirValidation;

    const warnings: string[] = [];
    let packageUpdated = true;

    const installProcess = Bun.spawnSync(["npm", "install", "-g", "@thecat69/cache-ctrl@latest"]);
    if (installProcess.exitCode !== 0) {
      packageUpdated = false;
      const npmError = textDecoder.decode(installProcess.stderr);
      warnings.push(npmError.length > 0 ? npmError : "npm install -g @thecat69/cache-ctrl@latest failed");
    }

    const installResult = await installCommand({ ...(args.configDir !== undefined ? { configDir: args.configDir } : {}) });
    if (!installResult.ok) {
      return {
        ok: false,
        error: installResult.error,
        code: installResult.code,
      };
    }

    return {
      ok: true,
      value: {
        packageUpdated,
        installedPaths: [installResult.value.toolPath, ...installResult.value.skillPaths],
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

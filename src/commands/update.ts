import os from "node:os";
import path from "node:path";

import type { UpdateArgs, UpdateResult } from "../types/commands.js";
import { ErrorCode, type Result } from "../types/result.js";

import { installCommand } from "./install.js";

const textDecoder = new TextDecoder();

/**
 * Updates the globally installed npm package and refreshes OpenCode integration files.
 */
export async function updateCommand(args: UpdateArgs): Promise<Result<UpdateResult>> {
  try {
    if (args.configDir !== undefined) {
      const absConfigDir = path.isAbsolute(args.configDir)
        ? path.resolve(args.configDir)
        : path.resolve(process.cwd(), args.configDir);
      const home = os.homedir();
      if (!absConfigDir.startsWith(home + path.sep) && absConfigDir !== home) {
        return {
          ok: false,
          error: `--config-dir must be within the user home directory, got: ${args.configDir}`,
          code: ErrorCode.INVALID_ARGS,
        };
      }
    }

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

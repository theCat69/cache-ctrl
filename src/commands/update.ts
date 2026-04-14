import path from "node:path";

import type { InstallResult, UpdateArgs, UpdateResult } from "../types/commands.js";
import { ErrorCode, type Result } from "../types/result.js";
import { resolveOpenCodeConfigDir } from "../files/openCodeInstaller.js";
import { validateConfigDir } from "./configDir.js";
import { toUnknownResult } from "../errors.js";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractInstallPayload(value: unknown): Pick<InstallResult, "toolPath" | "skillPaths"> | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  const maybeToolPath = value.toolPath;
  const maybeSkillPaths = value.skillPaths;
  if (typeof maybeToolPath === "string" && Array.isArray(maybeSkillPaths) && maybeSkillPaths.every((entry) => typeof entry === "string")) {
    return { toolPath: maybeToolPath, skillPaths: maybeSkillPaths };
  }

  return undefined;
}

/**
 * Updates the globally installed npm package and refreshes OpenCode integration files.
 *
 * Runs `npm install -g @thecat69/cache-ctrl@latest`, then spawns a subprocess to execute
 * `cache-ctrl install` so that the integration files are always written by the correct
 * binary (fixes path resolution on Windows).
 *
 * Partial-success behaviour:
 * - If `npm install` fails, `packageUpdated` is `false` and the error is appended to
 *   `warnings[]`; the integration install subprocess still runs.
 * - If the install subprocess exits 0 but returns non-JSON stdout, `installedPaths` is
 *   `[]` and a warning is appended: the integration files were still written correctly.
 * - If the install subprocess exits non-zero, the command returns a `FILE_WRITE_ERROR`.
 *
 * @param args - Must include a valid `configDir` (within the user home directory).
 * @returns `UpdateResult` with `packageUpdated`, `installedPaths`, and `warnings[]`.
 */
export async function updateCommand(args: UpdateArgs): Promise<Result<UpdateResult>> {
  try {
    const configDirValidation = validateConfigDir(args.configDir);
    if (!configDirValidation.ok) return configDirValidation;

    const configDir = resolveOpenCodeConfigDir(args.configDir);
    const commandDir = import.meta.dir;
    const packageRoot = path.resolve(String(commandDir), "../..");
    const entryPoint = path.join(packageRoot, "src", "index.ts");

    const warnings: string[] = [];
    let packageUpdated = true;

    const installProcess = Bun.spawnSync(["npm", "install", "-g", "@thecat69/cache-ctrl@latest"]);
    if (installProcess.exitCode !== 0) {
      packageUpdated = false;
      const npmError = new TextDecoder().decode(installProcess.stderr);
      warnings.push(npmError.length > 0 ? npmError : "npm install -g @thecat69/cache-ctrl@latest failed");
    }

    const integrationInstallProcess = Bun.spawnSync(
      [process.execPath, entryPoint, "install", "--config-dir", configDir],
      { stdout: "pipe", stderr: "pipe" },
    );

    if (integrationInstallProcess.exitCode !== 0) {
      const installError = new TextDecoder().decode(integrationInstallProcess.stderr);
      return {
        ok: false,
        error: installError.length > 0 ? installError : "cache-ctrl install failed",
        code: ErrorCode.FILE_WRITE_ERROR,
      };
    }

    let installedPaths: string[] = [];
    try {
      const installOutput = new TextDecoder().decode(integrationInstallProcess.stdout);
      const parsed = JSON.parse(installOutput) as unknown;

      const installPayload = extractInstallPayload(parsed);

      if (installPayload !== undefined) {
        installedPaths = [installPayload.toolPath, ...installPayload.skillPaths];
      }
    } catch {
      installedPaths = [];
      warnings.push("cache-ctrl install succeeded but returned unreadable output; installed paths unavailable");
    }

    return {
      ok: true,
      value: {
        packageUpdated,
        installedPaths,
        warnings,
      },
    };
  } catch (err) {
    return toUnknownResult(err);
  }
}

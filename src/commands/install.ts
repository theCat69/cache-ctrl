import path from "node:path";

import { installOpenCodeIntegration, resolveOpenCodeConfigDir } from "../files/openCodeInstaller.js";
import type { InstallArgs, InstallResult } from "../types/commands.js";
import type { Result } from "../types/result.js";

/**
 * Installs OpenCode tool wrapper and bundled skill files.
 *
 * @param args - {@link InstallArgs} command arguments.
 * @returns Promise<Result<InstallResult>>; common failures include FILE_WRITE_ERROR and UNKNOWN.
 */
export async function installCommand(
  args: InstallArgs,
  packageRoot: string = path.resolve(import.meta.dir, "../.."),
): Promise<Result<InstallResult>> {
  const configDir = resolveOpenCodeConfigDir(args.configDir);
  return installOpenCodeIntegration(configDir, packageRoot);
}

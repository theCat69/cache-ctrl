import path from "node:path";

import { installSkills, resolveOpenCodeConfigDir } from "../files/skillsInstaller.js";
import type { InstallArgs, InstallResult } from "../types/commands.js";
import type { Result } from "../types/result.js";

/**
 * Installs bundled skill files into the OpenCode config directory.
 *
 * @param args - {@link InstallArgs} command arguments.
 * @returns Promise<Result<InstallResult>>; common failures include FILE_WRITE_ERROR and UNKNOWN.
 */
export async function installCommand(
  args: InstallArgs,
  packageRoot: string = path.resolve(import.meta.dir, "../.."),
): Promise<Result<InstallResult>> {
  const configDir = resolveOpenCodeConfigDir(args.configDir);
  return installSkills(configDir, packageRoot);
}

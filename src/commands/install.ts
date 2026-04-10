import path from "node:path";

import { installOpenCodeIntegration, resolveOpenCodeConfigDir } from "../files/openCodeInstaller.js";
import type { InstallArgs, InstallResult } from "../types/commands.js";
import type { Result } from "../types/result.js";

export async function installCommand(
  args: InstallArgs,
  packageRoot: string = path.resolve(import.meta.dir, "../.."),
): Promise<Result<InstallResult>> {
  const configDir = resolveOpenCodeConfigDir(args.configDir);
  return installOpenCodeIntegration(configDir, packageRoot);
}

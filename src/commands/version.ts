import type { VersionArgs, VersionResult } from "../types/commands.js";
import type { Result } from "../types/result.js";

import packageJson from "../../package.json" with { type: "json" };

export function versionCommand(_args: VersionArgs = {}): Result<VersionResult["value"]> {
  return { ok: true, value: { version: packageJson.version } };
}

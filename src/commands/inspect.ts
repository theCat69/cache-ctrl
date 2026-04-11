import type { InspectArgs, InspectResult } from "../types/commands.js";
import { inspectExternalCommand } from "./inspectExternal.js";
import { inspectLocalCommand } from "./inspectLocal.js";
import type { Result } from "../types/result.js";

export async function inspectCommand(args: InspectArgs): Promise<Result<InspectResult["value"]>> {
  if (args.agent === "local") return inspectLocalCommand(args);
  return inspectExternalCommand(args);
}

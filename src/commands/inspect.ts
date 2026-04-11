import type { InspectArgs, InspectResult } from "../types/commands.js";
import { inspectExternalCommand } from "./inspectExternal.js";
import { inspectLocalCommand } from "./inspectLocal.js";
import type { Result } from "../types/result.js";

/**
 * Routes inspect requests to the agent-specific implementation.
 *
 * @param args - {@link InspectArgs} command arguments.
 * @returns Promise<Result<InspectResult["value"]>>; may return INVALID_ARGS,
 * FILE_NOT_FOUND, AMBIGUOUS_MATCH, PARSE_ERROR, or UNKNOWN.
 */
export async function inspectCommand(args: InspectArgs): Promise<Result<InspectResult["value"]>> {
  if (args.agent === "local") return inspectLocalCommand(args);
  return inspectExternalCommand(args);
}

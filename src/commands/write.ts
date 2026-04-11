import type { WriteArgs, WriteResult } from "../types/commands.js";
import { writeExternalCommand } from "./writeExternal.js";
import { writeLocalCommand } from "./writeLocal.js";
import type { Result } from "../types/result.js";

export async function writeCommand(args: WriteArgs): Promise<Result<WriteResult["value"]>> {
  if (args.agent === "local") return writeLocalCommand(args);
  return writeExternalCommand(args);
}

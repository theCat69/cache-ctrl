import { basename } from "node:path";

/** Returns the file name without its `.json` extension, or the name as-is if not `.json`. */
export function getFileStem(filePath: string): string {
  const name = basename(filePath);
  return name.endsWith(".json") ? name.slice(0, -5) : name;
}

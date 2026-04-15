import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/**
 * Resolve the application cache directory using XDG base directory semantics.
 *
 * @param appName - Application directory name appended to the base cache directory.
 * @returns `$XDG_CACHE_HOME/<appName>` when configured, otherwise `~/.cache/<appName>`.
 */
export function getXdgCacheDir(appName: string): string {
  const configuredBaseDir = process.env.XDG_CACHE_HOME?.trim();
  const cacheBaseDir = configuredBaseDir !== undefined && configuredBaseDir.length > 0 && isAbsolute(configuredBaseDir)
    ? configuredBaseDir
    : join(homedir(), ".cache");

  return join(cacheBaseDir, appName);
}

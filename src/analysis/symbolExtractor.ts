import { join } from "node:path";

import { detectLanguage } from "./languageDetector.js";
import type { FileSymbols } from "./fileSymbols.js";
import { parseFileSymbols } from "./treeSitterEngine.js";
import { downloadParser } from "../http/parserDownloader.js";
import { getXdgCacheDir } from "../platform/xdg.js";

/**
 * Extract import dependencies and export definitions from a source file.
 * Returns an empty FileSymbols if the file cannot be parsed.
 * Never throws.
 */
export async function extractSymbols(filePath: string, repoRoot: string): Promise<FileSymbols> {
  try {
    const language = detectLanguage(filePath);
    if (language === null) {
      return { deps: [], defs: [] };
    }

    const parserDirectory = join(getXdgCacheDir("cache-ctrl"), "parsers");
    const downloadResult = await downloadParser(language, parserDirectory);
    if (!downloadResult.ok) {
      process.stderr.write(`[cache-ctrl] Warning: ${downloadResult.error}\n`);
      return { deps: [], defs: [] };
    }

    return await parseFileSymbols(filePath, downloadResult.value, repoRoot);
  } catch {
    return { deps: [], defs: [] };
  }
}

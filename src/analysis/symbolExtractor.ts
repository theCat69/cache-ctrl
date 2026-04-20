import { join } from "node:path";

import { detectLanguage } from "./languageDetector.js";
import type { FileSymbols } from "./fileSymbols.js";
import { parseFileSymbols } from "./treeSitterEngine.js";
import { downloadParser } from "../http/parserDownloader.js";
import { getXdgCacheDir } from "../platform/xdg.js";

const PARSER_WARNING_DEDUP_WINDOW_MS = 1_000;
const recentParserWarningTimes = new Map<string, number>();

function writeParserWarning(message: string): void {
  const now = Date.now();

  for (const [warningMessage, loggedAt] of recentParserWarningTimes) {
    if (now - loggedAt >= PARSER_WARNING_DEDUP_WINDOW_MS) {
      recentParserWarningTimes.delete(warningMessage);
    }
  }

  const lastLoggedAt = recentParserWarningTimes.get(message);
  if (lastLoggedAt !== undefined && now - lastLoggedAt < PARSER_WARNING_DEDUP_WINDOW_MS) {
    return;
  }

  recentParserWarningTimes.set(message, now);
  process.stderr.write(`[cache-ctrl] Warning: ${message}\n`);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }

  return String(err);
}

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
      writeParserWarning(downloadResult.error);
      return { deps: [], defs: [] };
    }

    return await parseFileSymbols(filePath, downloadResult.value, repoRoot);
  } catch (err: unknown) {
    writeParserWarning(`Unexpected symbol extraction failure: ${errorMessage(err)}`);
    return { deps: [], defs: [] };
  }
}

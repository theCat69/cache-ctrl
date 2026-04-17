import { extname } from "node:path";

import { detectLanguageByExtension, type SupportedLanguage } from "./supportedLanguages.js";

/**
 * Detect a supported Tree-sitter language from a file extension.
 *
 * @param filePath - Source file path.
 * @returns Normalized language name or `null` when unsupported.
 */
export function detectLanguage(filePath: string): SupportedLanguage | null {
  const extension = extname(filePath).toLowerCase();
  return detectLanguageByExtension(extension);
}

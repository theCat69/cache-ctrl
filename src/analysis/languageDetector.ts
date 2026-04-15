import { extname } from "node:path";

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
};

/**
 * Detect a supported Tree-sitter language from a file extension.
 *
 * @param filePath - Source file path.
 * @returns Normalized language name or `null` when unsupported.
 */
export function detectLanguage(filePath: string): string | null {
  const extension = extname(filePath).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension] ?? null;
}

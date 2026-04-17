import { extname } from "node:path";

export const SUPPORTED_LANGUAGES = {
  typescript: {
    extensions: [".ts", ".tsx"] as const,
    wasmUrl:
      "https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-typescript.wasm",
  },
  javascript: {
    extensions: [".js", ".jsx", ".mjs", ".cjs"] as const,
    wasmUrl:
      "https://github.com/tree-sitter/tree-sitter-javascript/releases/download/v0.25.0/tree-sitter-javascript.wasm",
  },
  rust: {
    extensions: [".rs"] as const,
    wasmUrl: "https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.24.2/tree-sitter-rust.wasm",
  },
  python: {
    extensions: [".py"] as const,
    wasmUrl: "https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.25.0/tree-sitter-python.wasm",
  },
  go: {
    extensions: [".go"] as const,
    wasmUrl: "https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.25.0/tree-sitter-go.wasm",
  },
  java: {
    extensions: [".java"] as const,
    wasmUrl: "https://github.com/tree-sitter/tree-sitter-java/releases/download/v0.23.5/tree-sitter-java.wasm",
  },
  c: {
    extensions: [".c", ".h"] as const,
    wasmUrl: "https://github.com/tree-sitter/tree-sitter-c/releases/download/v0.24.1/tree-sitter-c.wasm",
  },
  cpp: {
    extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"] as const,
    wasmUrl: "https://github.com/tree-sitter/tree-sitter-cpp/releases/download/v0.23.4/tree-sitter-cpp.wasm",
  },
} as const;

export type SupportedLanguage = keyof typeof SUPPORTED_LANGUAGES;

type SupportedLanguageConfig = (typeof SUPPORTED_LANGUAGES)[SupportedLanguage];

function getSupportedLanguageIds(): SupportedLanguage[] {
  const languageIds: SupportedLanguage[] = [];

  for (const languageId of Object.keys(SUPPORTED_LANGUAGES)) {
    if (isSupportedLanguage(languageId)) {
      languageIds.push(languageId);
    }
  }

  return languageIds;
}

const SUPPORTED_LANGUAGE_IDS = getSupportedLanguageIds();

const SUPPORTED_SOURCE_EXTENSIONS_ARRAY = SUPPORTED_LANGUAGE_IDS.flatMap(
  (languageId) => SUPPORTED_LANGUAGES[languageId].extensions,
);

const SUPPORTED_SOURCE_EXTENSIONS_SET = new Set<string>(SUPPORTED_SOURCE_EXTENSIONS_ARRAY);

const LANGUAGE_BY_EXTENSION = SUPPORTED_SOURCE_EXTENSIONS_ARRAY.reduce<Record<string, SupportedLanguage>>(
  (mapping, extension) => {
    const language = resolveLanguageByExtension(extension);
    if (language !== null) {
      mapping[extension] = language;
    }
    return mapping;
  },
  {},
);

function resolveLanguageByExtension(extension: string): SupportedLanguage | null {
  for (const languageId of SUPPORTED_LANGUAGE_IDS) {
    const config = SUPPORTED_LANGUAGES[languageId];
    for (const supportedExtension of config.extensions) {
      if (supportedExtension === extension) {
        return languageId;
      }
    }
  }

  return null;
}

/**
 * Return true when a language identifier has parser support.
 */
export function isSupportedLanguage(language: string): language is SupportedLanguage {
  return language in SUPPORTED_LANGUAGES;
}

/**
 * Resolve parser metadata for a supported language id.
 */
export function getSupportedLanguageConfig(language: string): SupportedLanguageConfig | null {
  if (!isSupportedLanguage(language)) {
    return null;
  }

  return SUPPORTED_LANGUAGES[language];
}

/**
 * Resolve a supported language identifier from a file extension.
 */
export function detectLanguageByExtension(extension: string): SupportedLanguage | null {
  const normalizedExtension = extension.toLowerCase();
  return LANGUAGE_BY_EXTENSION[normalizedExtension] ?? null;
}

/**
 * Return true when a file extension is included in source graph analysis.
 */
export function isSupportedSourceExtension(extension: string): boolean {
  return SUPPORTED_SOURCE_EXTENSIONS_SET.has(extension.toLowerCase());
}

/**
 * Return all source extensions used by watch + graph resolution.
 */
export function getSupportedSourceExtensions(): readonly string[] {
  return SUPPORTED_SOURCE_EXTENSIONS_ARRAY;
}

/**
 * Return extension resolution order for extensionless dependencies emitted by a file.
 *
 * This keeps graphBuilder mostly language-agnostic while allowing same-language-first
 * resolution for parser-backed languages.
 */
export function getResolutionExtensionsForFile(filePath: string): readonly string[] {
  const extension = extname(filePath).toLowerCase();

  if (extension === ".ts") {
    return [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  }

  if (extension === ".tsx") {
    return [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs"];
  }

  if (extension === ".js") {
    return [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"];
  }

  if (extension === ".jsx") {
    return [".jsx", ".js", ".mjs", ".cjs", ".tsx", ".ts"];
  }

  if (extension === ".mjs") {
    return [".mjs", ".js", ".cjs", ".jsx", ".ts", ".tsx"];
  }

  if (extension === ".cjs") {
    return [".cjs", ".js", ".mjs", ".jsx", ".ts", ".tsx"];
  }

  if (extension === ".py") {
    return [".py"];
  }

  if (extension === ".rs") {
    return [".rs"];
  }

  if (extension === ".go") {
    return [".go"];
  }

  if (extension === ".java") {
    return [".java"];
  }

  if ([".c", ".h"].includes(extension)) {
    return [".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"];
  }

  if ([".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"].includes(extension)) {
    return [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx", ".c", ".h"];
  }

  return SUPPORTED_SOURCE_EXTENSIONS_ARRAY;
}

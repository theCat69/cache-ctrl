# Supported languages manifest — one source of truth for parser URLs and extensions

## Pattern: centralize parser-backed language metadata and consume it from watch, detection, and downloader

Use one manifest to avoid drift between language detection, watch filtering, and parser URL resolution.

```typescript
// src/analysis/supportedLanguages.ts

export const SUPPORTED_LANGUAGES = {
  typescript: {
    extensions: [".ts", ".tsx"] as const,
    wasmUrl: "https://.../tree-sitter-typescript.wasm",
  },
  javascript: {
    extensions: [".js", ".jsx", ".mjs", ".cjs"] as const,
    wasmUrl: "https://.../tree-sitter-javascript.wasm",
  },
  // ... python, rust, go, java, c, cpp
} as const;

export function detectLanguageByExtension(extension: string): SupportedLanguage | null {
  const normalizedExtension = extension.toLowerCase();
  return LANGUAGE_BY_EXTENSION[normalizedExtension] ?? null;
}

export function isSupportedSourceExtension(extension: string): boolean {
  return SUPPORTED_SOURCE_EXTENSIONS_SET.has(extension.toLowerCase());
}

export function getSupportedLanguageConfig(language: string): SupportedLanguageConfig | null {
  if (!isSupportedLanguage(language)) {
    return null;
  }
  return SUPPORTED_LANGUAGES[language];
}
```

```typescript
// src/commands/watch.ts
import { isSupportedSourceExtension } from "../analysis/supportedLanguages.js";

export function isSourceFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return isSupportedSourceExtension(extension);
}
```

```typescript
// src/http/parserDownloader.ts
import { getSupportedLanguageConfig } from "../analysis/supportedLanguages.js";

function resolveParserWasmUrl(language: string): Result<string> {
  const config = getSupportedLanguageConfig(language);
  if (config === null) {
    return {
      ok: false,
      error: `No WASM URL configured for language "${language}"`,
      code: ErrorCode.PARSER_DOWNLOAD_ERROR,
    };
  }

  return { ok: true, value: config.wasmUrl };
}
```

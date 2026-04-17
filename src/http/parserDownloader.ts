import { lstat, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { ErrorCode, type Result } from "../types/result.js";

const LANGUAGE_WASM_URLS: Record<string, string> = {
  typescript: "https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-typescript.wasm",
  javascript: "https://unpkg.com/@tree-sitter/javascript/tree-sitter-javascript.wasm",
  rust: "https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.24.2/tree-sitter-rust.wasm",
  python: "https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.25.0/tree-sitter-python.wasm",
  go: "https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.25.0/tree-sitter-go.wasm",
  java: "https://github.com/tree-sitter/tree-sitter-java/releases/download/v0.23.5/tree-sitter-java.wasm",
  c: "https://github.com/tree-sitter/tree-sitter-c/releases/download/v0.24.1/tree-sitter-c.wasm",
  cpp: "https://github.com/tree-sitter/tree-sitter-cpp/releases/download/v0.23.4/tree-sitter-cpp.wasm",
};

function resolveParserWasmUrl(language: string): Result<string> {
  const url = LANGUAGE_WASM_URLS[language as keyof typeof LANGUAGE_WASM_URLS];
  if (url === undefined) {
    return {
      ok: false,
      error: `No WASM URL configured for language "${language}"`,
      code: ErrorCode.PARSER_DOWNLOAD_ERROR,
    };
  }

  return { ok: true, value: url };
}

/**
 * Download and cache a Tree-sitter WASM parser for a language.
 *
 * @param language - Normalized parser language key.
 * @param destDir - Directory where parser files are cached.
 * @returns Absolute parser file path on success.
 */
export async function downloadParser(language: string, destDir: string): Promise<Result<string>> {
  const SAFE_LANGUAGE_PATTERN = /^[a-z][a-z0-9_-]*$/;
  if (!SAFE_LANGUAGE_PATTERN.test(language)) {
    return {
      ok: false,
      error: `Invalid language identifier: "${language}"`,
      code: ErrorCode.PARSER_DOWNLOAD_ERROR,
    };
  }

  const urlResult = resolveParserWasmUrl(language);
  if (!urlResult.ok) {
    return urlResult;
  }

  const absoluteDestDir = resolve(destDir);
  const wasmPath = resolve(absoluteDestDir, `${language}.wasm`);
  const tempPath = resolve(
    absoluteDestDir,
    `${language}.wasm.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`,
  );

  try {
    await mkdir(absoluteDestDir, { recursive: true });

    try {
      const stat = await lstat(wasmPath);
      if (!stat.isSymbolicLink()) {
        return { ok: true, value: wasmPath };
      }
    } catch {
      // Parser not yet cached; continue with download.
    }

    process.stderr.write(`Downloading tree-sitter parser for ${language}...\n`);

    const response = await fetch(urlResult.value, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      return {
        ok: false,
        code: ErrorCode.PARSER_DOWNLOAD_ERROR,
        error: `Failed to download parser for ${language}: HTTP ${response.status}`,
      };
    }

    const wasmArrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(wasmArrayBuffer);
    if (bytes.length < 4 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
      return {
        ok: false,
        error: `Downloaded content for "${language}" is not a valid WASM binary`,
        code: ErrorCode.PARSER_DOWNLOAD_ERROR,
      };
    }

    await writeFile(tempPath, bytes);
    await rename(tempPath, wasmPath);

    return { ok: true, value: wasmPath };
  } catch (err) {
    try {
      await unlink(tempPath);
    } catch {
      // Ignore temp cleanup failures.
    }

    const error = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: ErrorCode.PARSER_DOWNLOAD_ERROR,
      error: `Failed to cache parser for ${language}: ${error}`,
    };
  }
}

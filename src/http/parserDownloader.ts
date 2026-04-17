import { lstat, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getSupportedLanguageConfig } from "../analysis/supportedLanguages.js";
import { ErrorCode, type Result } from "../types/result.js";

const parserDownloadPromises = new Map<string, Promise<Result<string>>>();
const ALLOWED_PARSER_DOWNLOAD_HOSTNAMES = new Set([
  "github.com",
  "github-releases.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
]);

function isAllowedParserDownloadHostname(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ALLOWED_PARSER_DOWNLOAD_HOSTNAMES.has(hostname);
  } catch {
    return false;
  }
}

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

function createParserDownloadKey(language: string, absoluteDestDir: string): string {
  return `${absoluteDestDir}:${language}`;
}

async function downloadAndCacheParser(language: string, absoluteDestDir: string, url: string): Promise<Result<string>> {
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

    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });

    if (!isAllowedParserDownloadHostname(response.url)) {
      return {
        ok: false,
        code: ErrorCode.PARSER_DOWNLOAD_ERROR,
        error: `Failed to download parser for ${language}: redirected to untrusted host`,
      };
    }

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
  const downloadKey = createParserDownloadKey(language, absoluteDestDir);
  const ongoingDownload = parserDownloadPromises.get(downloadKey);
  if (ongoingDownload !== undefined) {
    return await ongoingDownload;
  }

  const downloadPromise = downloadAndCacheParser(language, absoluteDestDir, urlResult.value).finally(() => {
    parserDownloadPromises.delete(downloadKey);
  });

  parserDownloadPromises.set(downloadKey, downloadPromise);
  return await downloadPromise;
}

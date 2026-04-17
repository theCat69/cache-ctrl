# On-demand WASM parser download: manifest-driven URL resolution, secure redirects, and coalesced writes

## Pattern: downloadParser() resolves URLs from the language manifest, coalesces concurrent downloads, and validates redirect + binary integrity

`parserDownloader.ts` shows how to fetch parser assets safely: coalesce concurrent callers,
follow GitHub release redirects through an allowlist, validate the WASM magic bytes, then
write atomically with a temp-file rename.

```typescript
// src/http/parserDownloader.ts

import { lstat, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getSupportedLanguageConfig } from "../analysis/supportedLanguages.js";
import { ErrorCode, type Result } from "../types/result.js";

// Coalesce concurrent download requests for the same parser.
const parserDownloadPromises = new Map<string, Promise<Result<string>>>();

// Allowlist covers the initial URL and every GitHub CDN redirect hop.
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
  // URL source of truth lives in supportedLanguages.ts — never duplicated here.
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

async function downloadAndCacheParser(
  language: string,
  absoluteDestDir: string,
  url: string,
): Promise<Result<string>> {
  const wasmPath = resolve(absoluteDestDir, `${language}.wasm`);
  // Randomised suffix prevents collisions when multiple processes start downloads simultaneously.
  const tempPath = resolve(
    absoluteDestDir,
    `${language}.wasm.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`,
  );

  try {
    await mkdir(absoluteDestDir, { recursive: true });

    // Cache short-circuit: lstat rejects symlinks to prevent TOCTOU attacks.
    try {
      const stat = await lstat(wasmPath);
      if (!stat.isSymbolicLink()) {
        return { ok: true, value: wasmPath };
      }
    } catch {
      // Parser not yet cached; continue with download.
    }

    process.stderr.write(`Downloading tree-sitter parser for ${language}...\n`);

    // Allow GitHub release redirects but verify the final host is still trusted.
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

    const bytes = new Uint8Array(await response.arrayBuffer());

    // Validate WASM magic bytes (\0asm) before persisting.
    if (bytes.length < 4 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
      return {
        ok: false,
        error: `Downloaded content for "${language}" is not a valid WASM binary`,
        code: ErrorCode.PARSER_DOWNLOAD_ERROR,
      };
    }

    // Atomic write: temp file first, then rename.
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

  // Return the in-flight promise to avoid duplicate downloads from concurrent callers.
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
```

## Key rules

- Never duplicate WASM URLs — always read them from `supportedLanguages.ts` via `getSupportedLanguageConfig`
- Build cache keys from normalized inputs (`absoluteDestDir` + language) so coalescing is deterministic across callers
- Use `lstat` (not `access`) for the cache short-circuit; reject symlinks to prevent TOCTOU attacks
- Set `redirect: "follow"` but check `response.url` against `ALLOWED_PARSER_DOWNLOAD_HOSTNAMES` after the redirect chain resolves
- Validate the `\0asm` magic bytes before persisting to disk
- Write to a randomised `*.tmp.<pid>.<random>` path, then `rename()` into place atomically
- Store in-flight `Promise`s in `parserDownloadPromises` to coalesce concurrent callers on the same key
- Clean up temp files in a best-effort `catch` path
- Return typed `Result` failures (`PARSER_DOWNLOAD_ERROR`) for every failure branch

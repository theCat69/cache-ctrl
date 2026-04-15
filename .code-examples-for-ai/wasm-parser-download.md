# On-demand WASM parser download with cache short-circuit and atomic rename

## Pattern: downloadParser() caches and writes parser atomically

`parserDownloader.ts` demonstrates how to fetch parser assets on demand while preventing partial reads:

```typescript
// src/http/parserDownloader.ts

import { access, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { ErrorCode, type Result } from "../types/result.js";

export async function downloadParser(language: string, destDir: string): Promise<Result<string>> {
  const absoluteDestDir = resolve(destDir);
  const wasmPath = resolve(absoluteDestDir, `${language}.wasm`);
  const tempPath = resolve(absoluteDestDir, `${language}.wasm.tmp.${process.pid}`);

  try {
    await mkdir(absoluteDestDir, { recursive: true });

    // Cache short-circuit: skip network when parser already exists.
    try {
      await access(wasmPath);
      return { ok: true, value: wasmPath };
    } catch {
      // Missing cache entry — proceed to download.
    }

    process.stderr.write(`Downloading tree-sitter parser for ${language}...\n`);

    const response = await fetch(resolveParserWasmUrl(language));
    if (!response.ok) {
      return {
        ok: false,
        code: ErrorCode.PARSER_DOWNLOAD_ERROR,
        error: `Failed to download parser for ${language}: HTTP ${response.status}`,
      };
    }

    // Atomic write: temp file first, then rename.
    const wasmArrayBuffer = await response.arrayBuffer();
    await writeFile(tempPath, new Uint8Array(wasmArrayBuffer));
    await rename(tempPath, wasmPath);

    return { ok: true, value: wasmPath };
  } catch (err) {
    // Best-effort temp-file cleanup.
    try {
      await unlink(tempPath);
    } catch {
      // Ignore cleanup failures.
    }

    const error = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      code: ErrorCode.PARSER_DOWNLOAD_ERROR,
      error: `Failed to cache parser for ${language}: ${error}`,
    };
  }
}
```

## Key rules

- Always `mkdir(..., { recursive: true })` before checking/writing cache files
- Use `access()` to skip download when cache entry already exists
- Write bytes to `*.tmp.<pid>` and `rename()` into place atomically
- Return typed `Result` failures (`PARSER_DOWNLOAD_ERROR`) for network and write failures
- Clean up temp files in a best-effort catch path

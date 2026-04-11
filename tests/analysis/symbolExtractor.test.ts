import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractSymbols } from "../../src/analysis/symbolExtractor.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("extractSymbols", () => {
  it("extracts relative imports and export definitions from a TypeScript file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "cache-ctrl-analysis-symbols-"));
    tempDirs.push(tempDir);

    const filePath = join(tempDir, "entry.ts");
    await writeFile(
      filePath,
      [
        "import { helper } from './helper.js';",
        "import './side-effect';",
        "export const alpha = 1;",
        "const beta = 2;",
        "export { beta };",
        "export default function gamma() { return helper + beta; }",
      ].join("\n"),
    );

    const symbols = await extractSymbols(filePath, tempDir);

    expect(new Set(symbols.deps)).toEqual(
      new Set([join(tempDir, "helper.js"), join(tempDir, "side-effect")]),
    );
    expect(new Set(symbols.defs)).toEqual(new Set(["alpha", "beta", "default", "gamma"]));
  });

  it("does not include non-relative imports in dependencies", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "cache-ctrl-analysis-symbols-"));
    tempDirs.push(tempDir);

    const filePath = join(tempDir, "entry.ts");
    await writeFile(
      filePath,
      [
        "import { z } from 'zod';",
        "import { localValue } from './local.js';",
        "export { localValue };",
      ].join("\n"),
    );

    const symbols = await extractSymbols(filePath, tempDir);
    expect(symbols.deps).toEqual([join(tempDir, "local.js")]);
  });

  it("returns empty symbols when parsing fails", async () => {
    const symbols = await extractSymbols("/path/that/does/not/exist.ts", "/");
    expect(symbols).toEqual({ deps: [], defs: [] });
  });

  it("excludes resolved relative imports that escape repo root", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "cache-ctrl-analysis-symbols-"));
    tempDirs.push(tempDir);

    const filePath = join(tempDir, "src", "entry.ts");
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(filePath, "import '../../../outside.js';\nexport const inside = true;\n");

    const symbols = await extractSymbols(filePath, tempDir);
    expect(symbols.deps).toEqual([]);
  });
});

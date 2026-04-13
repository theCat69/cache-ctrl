import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildGraph } from "../../src/analysis/graphBuilder.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("buildGraph", () => {
  it("builds dependency edges for files within the provided list", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "cache-ctrl-analysis-graph-"));
    tempDirs.push(tempDir);

    const fileA = join(tempDir, "a.ts");
    const fileB = join(tempDir, "b.ts");

    await writeFile(fileA, "import { b } from './b.js';\nexport const a = b;");
    await writeFile(fileB, "export const b = 1;");

    const graph = await buildGraph([fileA, fileB], tempDir);

    const nodeA = graph.get(fileA);
    const nodeB = graph.get(fileB);

    expect(nodeA).toBeDefined();
    expect(nodeB).toBeDefined();
    expect(nodeA?.deps).toEqual([fileB]);
    expect(nodeB?.deps).toEqual([]);
  });

  it("filters out dependencies not present in filePaths", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "cache-ctrl-analysis-graph-"));
    tempDirs.push(tempDir);

    const fileA = join(tempDir, "a.ts");
    const fileB = join(tempDir, "b.ts");
    const fileC = join(tempDir, "c.ts");

    await writeFile(fileA, "import { b } from './b.js';\nimport { c } from './c.js';\nexport const a = b + c;");
    await writeFile(fileB, "export const b = 1;");
    await writeFile(fileC, "export const c = 2;");

    const graph = await buildGraph([fileA, fileB], tempDir);
    const nodeA = graph.get(fileA);

    expect(nodeA).toBeDefined();
    expect(nodeA?.deps).toEqual([fileB]);
  });

  it("resolves .jsx imports to known .tsx files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "cache-ctrl-analysis-graph-"));
    tempDirs.push(tempDir);

    const entryFile = join(tempDir, "entry.ts");
    const componentFile = join(tempDir, "component.tsx");

    await writeFile(entryFile, "import { Component } from './component.jsx';\nexport const use = Component;");
    await writeFile(componentFile, "export const Component = () => null;");

    const graph = await buildGraph([entryFile, componentFile], tempDir);
    const entryNode = graph.get(entryFile);

    expect(entryNode).toBeDefined();
    expect(entryNode?.deps).toEqual([componentFile]);
  });
});

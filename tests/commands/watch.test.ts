import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  rebuildGraphCache,
  serializeGraphToCache,
  isSourceFile,
  resolveBunWatch,
  resolveSourceFilePaths,
} from "../../src/commands/watch.js";
import type { DependencyGraph } from "../../src/analysis/graphBuilder.js";
import { ErrorCode } from "../../src/types/result.js";

describe("watch helpers", () => {
  it("serializeGraphToCache converts DependencyGraph to graph cache files format", () => {
    const graph: DependencyGraph = new Map([
      [
        "/repo/src/a.ts",
        {
          deps: ["/repo/src/b.ts"],
          defs: ["A"],
        },
      ],
      [
        "/repo/src/b.ts",
        {
          deps: [],
          defs: ["B"],
        },
      ],
    ]);

    const files = serializeGraphToCache(graph);

    expect(files["/repo/src/a.ts"]).toEqual({
      rank: 0,
      deps: ["/repo/src/b.ts"],
      defs: ["A"],
    });
    expect(files["/repo/src/b.ts"]).toEqual({
      rank: 0,
      deps: [],
      defs: ["B"],
    });
  });

  it("isSourceFile accepts TS/JS variants and rejects non-source files", () => {
    expect(isSourceFile("src/a.ts")).toBe(true);
    expect(isSourceFile("src/a.tsx")).toBe(true);
    expect(isSourceFile("src/a.js")).toBe(true);
    expect(isSourceFile("src/a.jsx")).toBe(true);
    expect(isSourceFile("src/a.json")).toBe(false);
    expect(isSourceFile("README.md")).toBe(false);
  });

  it("resolveSourceFilePaths filters non-TS/JS files", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "cache-ctrl-watch-"));
    const srcDir = join(repoRoot, "src");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "a.ts"), "export const a = 1;\n", "utf-8");
    await writeFile(join(srcDir, "b.tsx"), "export const b = <div />;\n", "utf-8");
    await writeFile(join(srcDir, "c.js"), "export const c = 1;\n", "utf-8");
    await writeFile(join(srcDir, "d.jsx"), "export const d = <div />;\n", "utf-8");

    const mockGetTrackedFiles = async (): Promise<string[]> => [
      "src/a.ts",
      "src/b.tsx",
      "src/c.js",
      "src/d.jsx",
      "src/e.json",
      "README.md",
    ];

    const filePaths = await resolveSourceFilePaths(repoRoot, mockGetTrackedFiles);

    expect(new Set(filePaths)).toEqual(
      new Set([
        join(repoRoot, "src", "a.ts"),
        join(repoRoot, "src", "b.tsx"),
        join(repoRoot, "src", "c.js"),
        join(repoRoot, "src", "d.jsx"),
      ]),
    );

    await rm(repoRoot, { recursive: true, force: true });
  });

  it("resolveSourceFilePaths excludes symlinked paths escaping repo root", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "cache-ctrl-watch-"));
    const outsideRoot = await mkdtemp(join(tmpdir(), "cache-ctrl-watch-outside-"));
    const srcDir = join(repoRoot, "src");
    await mkdir(srcDir, { recursive: true });

    const insideFile = join(srcDir, "inside.ts");
    const outsideFile = join(outsideRoot, "outside.ts");
    const symlinkPath = join(srcDir, "outside-link.ts");

    await writeFile(insideFile, "export const inside = true;\n", "utf-8");
    await writeFile(outsideFile, "export const outside = true;\n", "utf-8");
    await symlink(outsideFile, symlinkPath);

    const mockGetTrackedFiles = async (): Promise<string[]> => ["src/inside.ts", "src/outside-link.ts"];

    const filePaths = await resolveSourceFilePaths(repoRoot, mockGetTrackedFiles);
    expect(filePaths).toEqual([insideFile]);

    await rm(repoRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  });

  it("rebuildGraphCache logs and returns when graph cache write fails", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const dependencies = {
      resolveSourceFilePaths: vi.fn(async () => ["/repo/src/a.ts"]),
      buildGraph: vi.fn(async (): Promise<DependencyGraph> =>
        new Map([
          [
            "/repo/src/a.ts",
            {
              deps: [],
              defs: ["A"],
            },
          ],
        ]),
      ),
      resolveGraphCachePath: vi.fn(() => "/repo/.cache-ctrl/graph.json"),
      writeCache: vi.fn(async () => ({
        ok: false as const,
        error: "disk full",
        code: ErrorCode.FILE_WRITE_ERROR,
      })),
    };

    await expect(rebuildGraphCache("/repo", "/repo/src/a.ts", false, dependencies)).resolves.toEqual({
      ok: false,
      error: "disk full",
      code: ErrorCode.FILE_WRITE_ERROR,
    });

    expect(stderrSpy).toHaveBeenCalledWith("[watch] Failed to update graph cache: disk full\n");
    expect(dependencies.writeCache).toHaveBeenCalledOnce();

    stderrSpy.mockRestore();
  });

  it("resolveBunWatch returns UNKNOWN when Bun.watch is unavailable", () => {
    const globalObject = globalThis as Record<string, unknown>;
    const originalBun = globalObject.Bun;
    globalObject.Bun = undefined;

    try {
      const result = resolveBunWatch();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(ErrorCode.UNKNOWN);
    } finally {
      globalObject.Bun = originalBun;
    }
  });
});

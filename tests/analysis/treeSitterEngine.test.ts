import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  initMock,
  languageLoadMock,
  readFileMock,
  setLanguageMock,
  parseImplMock,
  queryImplMock,
} = vi.hoisted(() => ({
  initMock: vi.fn(),
  languageLoadMock: vi.fn(),
  readFileMock: vi.fn(),
  setLanguageMock: vi.fn(),
  parseImplMock: vi.fn(),
  queryImplMock: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
}));

vi.mock("web-tree-sitter", () => {
  class ParserMock {
    static init = initMock;

    setLanguage(language: unknown): void {
      setLanguageMock(language);
    }

    parse(source: string): { rootNode: SyntaxNodeLike } {
      const parseResult = parseImplMock(source);
      if (
        typeof parseResult === "object" &&
        parseResult !== null &&
        "rootNode" in parseResult
      ) {
        const rootNode = parseResult.rootNode;
        if (isSyntaxNodeLike(rootNode)) {
          return { rootNode };
        }
      }

      return { rootNode: createNode("program", 0, source.length) };
    }
  }

  return {
    Parser: ParserMock,
    Language: {
      load: languageLoadMock,
    },
  };
});

let parseFileSymbols: typeof import("../../src/analysis/treeSitterEngine.js").parseFileSymbols;

interface SyntaxNodeLike {
  type: string;
  startIndex: number;
  endIndex: number;
  childCount: number;
  child(index: number): SyntaxNodeLike | null;
}

interface QueryCapture {
  node: SyntaxNodeLike;
}

interface QueryLike {
  captures(node: SyntaxNodeLike): QueryCapture[];
}

interface LanguageLike {
  query(queryText: string): QueryLike;
}

function isSyntaxNodeLike(value: unknown): value is SyntaxNodeLike {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    "type" in value &&
    "startIndex" in value &&
    "endIndex" in value &&
    "childCount" in value &&
    "child" in value
  );
}

function createNode(type: string, startIndex: number, endIndex: number, children: SyntaxNodeLike[] = []): SyntaxNodeLike {
  return {
    type,
    startIndex,
    endIndex,
    childCount: children.length,
    child(index: number): SyntaxNodeLike | null {
      return children[index] ?? null;
    },
  };
}

function createTypeScriptFixtureSource(): string {
  return [
    "import { dep } from './dep.js';",
    "export const alpha = dep;",
    "const required = require('./req.js');",
    "export default required;",
  ].join("\n");
}

function setupTypeScriptFixture(source: string): SyntaxNodeLike {
  const importLine = "import { dep } from './dep.js';";
  const exportLine = "export const alpha = dep;";
  const requireLine = "const required = require('./req.js');";
  const exportDefaultLine = "export default required;";

  const importStart = source.indexOf(importLine);
  const exportStart = source.indexOf(exportLine);
  const requireStart = source.indexOf(requireLine);
  const exportDefaultStart = source.indexOf(exportDefaultLine);

  const importLiteralToken = "'./dep.js'";
  const requireLiteralToken = "'./req.js'";

  const importLiteralStart = source.indexOf(importLiteralToken);
  const requireLiteralStart = source.indexOf(requireLiteralToken);

  const importNode = createNode(
    "import_statement",
    importStart,
    importStart + importLine.length,
    [createNode("string", importLiteralStart, importLiteralStart + importLiteralToken.length)],
  );

  const exportNode = createNode("export_statement", exportStart, exportStart + exportLine.length);
  const exportDefaultNode = createNode(
    "export_statement",
    exportDefaultStart,
    exportDefaultStart + exportDefaultLine.length,
  );

  const requireNode = createNode(
    "call_expression",
    requireStart + "const required = ".length,
    requireStart + requireLine.length - 1,
    [createNode("string", requireLiteralStart, requireLiteralStart + requireLiteralToken.length)],
  );

  const rootNode = createNode("program", 0, source.length, [
    importNode,
    exportNode,
    requireNode,
    exportDefaultNode,
  ]);

  queryImplMock.mockImplementation((queryText: string) => {
    if (queryText.includes("import_statement")) {
      return {
        captures(): QueryCapture[] {
          return [{ node: importNode }];
        },
      };
    }

    if (queryText.includes("export_statement")) {
      return {
        captures(): QueryCapture[] {
          return [{ node: exportNode }, { node: exportDefaultNode }];
        },
      };
    }

    if (queryText.includes("call_expression")) {
      return {
        captures(): QueryCapture[] {
          return [{ node: requireNode }];
        },
      };
    }

    return {
      captures(): QueryCapture[] {
        return [];
      },
    };
  });

  return rootNode;
}

describe("parseFileSymbols", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    initMock.mockResolvedValue(undefined);
    const language: LanguageLike = {
      query(queryText: string): QueryLike {
        return queryImplMock(queryText) as QueryLike;
      },
    };
    languageLoadMock.mockResolvedValue(language);

    ({ parseFileSymbols } = await import("../../src/analysis/treeSitterEngine.js"));
  });

  it("extracts dependency and definition symbols for TypeScript", async () => {
    const source = createTypeScriptFixtureSource();
    const rootNode = setupTypeScriptFixture(source);
    readFileMock.mockResolvedValue(source);
    parseImplMock.mockReturnValue({ rootNode });

    const symbols = await parseFileSymbols("/repo/src/entry.ts", "/cache/parsers/typescript.wasm", "/repo");

    expect(new Set(symbols.deps)).toEqual(new Set(["/repo/src/dep.js", "/repo/src/req.js"]));
    expect(new Set(symbols.defs)).toEqual(new Set(["alpha", "default"]));
  });

  it("returns empty symbols on parse/read errors", async () => {
    readFileMock.mockRejectedValue(new Error("read failure"));

    const symbols = await parseFileSymbols("/repo/src/broken.ts", "/cache/parsers/typescript.wasm", "/repo");
    expect(symbols).toEqual({ deps: [], defs: [] });
  });

  it("initializes parser runtime once and caches language by wasmPath", async () => {
    const source = createTypeScriptFixtureSource();
    const rootNode = setupTypeScriptFixture(source);
    readFileMock.mockResolvedValue(source);
    parseImplMock.mockReturnValue({ rootNode });

    await Promise.all([
      parseFileSymbols("/repo/src/one.ts", "/cache/parsers/typescript.wasm", "/repo"),
      parseFileSymbols("/repo/src/two.ts", "/cache/parsers/typescript.wasm", "/repo"),
    ]);

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(languageLoadMock).toHaveBeenCalledTimes(1);
  });

  it("filters dependencies that resolve outside repoRoot", async () => {
    const source = [
      "import inRepo from './dep.ts';",
      "import outside from '../../../outside.ts';",
    ].join("\n");

    const inRepoLine = "import inRepo from './dep.ts';";
    const outsideLine = "import outside from '../../../outside.ts';";
    const inRepoLiteralToken = "'./dep.ts'";
    const outsideLiteralToken = "'../../../outside.ts'";

    const inRepoStart = source.indexOf(inRepoLine);
    const outsideStart = source.indexOf(outsideLine);
    const inRepoLiteralStart = source.indexOf(inRepoLiteralToken);
    const outsideLiteralStart = source.indexOf(outsideLiteralToken);

    const inRepoImportNode = createNode(
      "import_statement",
      inRepoStart,
      inRepoStart + inRepoLine.length,
      [createNode("string", inRepoLiteralStart, inRepoLiteralStart + inRepoLiteralToken.length)],
    );
    const outsideImportNode = createNode(
      "import_statement",
      outsideStart,
      outsideStart + outsideLine.length,
      [createNode("string", outsideLiteralStart, outsideLiteralStart + outsideLiteralToken.length)],
    );

    const rootNode = createNode("program", 0, source.length, [inRepoImportNode, outsideImportNode]);
    readFileMock.mockResolvedValue(source);
    parseImplMock.mockReturnValue({ rootNode });

    queryImplMock.mockImplementation((queryText: string) => {
      if (queryText.includes("import_statement")) {
        return {
          captures(): QueryCapture[] {
            return [{ node: inRepoImportNode }, { node: outsideImportNode }];
          },
        };
      }

      return {
        captures(): QueryCapture[] {
          return [];
        },
      };
    });

    const symbols = await parseFileSymbols(
      "/repo/src/nested/entry.ts",
      "/cache/parsers/typescript.wasm",
      "/repo",
    );

    expect(symbols.deps).toEqual(["/repo/src/nested/dep.ts"]);
  });
});

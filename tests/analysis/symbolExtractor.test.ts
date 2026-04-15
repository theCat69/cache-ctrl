import { beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

const {
  detectLanguageMock,
  downloadParserMock,
  parseFileSymbolsMock,
  getXdgCacheDirMock,
} = vi.hoisted(() => ({
  detectLanguageMock: vi.fn(),
  downloadParserMock: vi.fn(),
  parseFileSymbolsMock: vi.fn(),
  getXdgCacheDirMock: vi.fn(),
}));

vi.mock("../../src/analysis/languageDetector.js", () => ({
  detectLanguage: detectLanguageMock,
}));

vi.mock("../../src/http/parserDownloader.js", () => ({
  downloadParser: downloadParserMock,
}));

vi.mock("../../src/analysis/treeSitterEngine.js", () => ({
  parseFileSymbols: parseFileSymbolsMock,
}));

vi.mock("../../src/platform/xdg.js", () => ({
  getXdgCacheDir: getXdgCacheDirMock,
}));

import { extractSymbols } from "../../src/analysis/symbolExtractor.js";
import { ErrorCode } from "../../src/types/result.js";

describe("extractSymbols", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    detectLanguageMock.mockReturnValue("typescript");
    getXdgCacheDirMock.mockReturnValue(join("/cache", "cache-ctrl"));
    downloadParserMock.mockResolvedValue({ ok: true, value: "/cache/cache-ctrl/parsers/typescript.wasm" });
    parseFileSymbolsMock.mockResolvedValue({ deps: ["/repo/src/dep.ts"], defs: ["alpha"] });
  });

  it("returns empty symbols for unsupported files", async () => {
    detectLanguageMock.mockReturnValue(null);

    const symbols = await extractSymbols("/repo/README.md", "/repo");

    expect(symbols).toEqual({ deps: [], defs: [] });
    expect(downloadParserMock).not.toHaveBeenCalled();
    expect(parseFileSymbolsMock).not.toHaveBeenCalled();
  });

  it("downloads parser and delegates to tree-sitter engine", async () => {
    const symbols = await extractSymbols("/repo/src/entry.ts", "/repo");

    expect(downloadParserMock).toHaveBeenCalledWith(
      "typescript",
      join("/cache", "cache-ctrl", "parsers"),
    );
    expect(parseFileSymbolsMock).toHaveBeenCalledWith(
      "/repo/src/entry.ts",
      "/cache/cache-ctrl/parsers/typescript.wasm",
      "/repo",
    );
    expect(symbols).toEqual({ deps: ["/repo/src/dep.ts"], defs: ["alpha"] });
  });

  it("returns empty symbols when parser download fails", async () => {
    downloadParserMock.mockResolvedValue({
      ok: false,
      code: ErrorCode.PARSER_DOWNLOAD_ERROR,
      error: "network unavailable",
    });

    const symbols = await extractSymbols("/repo/src/entry.ts", "/repo");

    expect(symbols).toEqual({ deps: [], defs: [] });
    expect(parseFileSymbolsMock).not.toHaveBeenCalled();
  });

  it("returns empty symbols when engine throws", async () => {
    parseFileSymbolsMock.mockRejectedValue(new Error("parse crash"));

    const symbols = await extractSymbols("/repo/src/entry.ts", "/repo");

    expect(symbols).toEqual({ deps: [], defs: [] });
  });
});

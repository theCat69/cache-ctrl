import { describe, expect, it } from "vitest";

import {
  detectLanguageByExtension,
  getResolutionExtensionsForFile,
  getSupportedLanguageConfig,
  getSupportedSourceExtensions,
  isSupportedLanguage,
  isSupportedSourceExtension,
} from "../../src/analysis/supportedLanguages.js";

describe("supportedLanguages manifest", () => {
  it("maps known extensions to parser language ids", () => {
    expect(detectLanguageByExtension(".ts")).toBe("typescript");
    expect(detectLanguageByExtension(".tsx")).toBe("typescript");
    expect(detectLanguageByExtension(".js")).toBe("javascript");
    expect(detectLanguageByExtension(".jsx")).toBe("javascript");
    expect(detectLanguageByExtension(".mjs")).toBe("javascript");
    expect(detectLanguageByExtension(".cjs")).toBe("javascript");
    expect(detectLanguageByExtension(".py")).toBe("python");
    expect(detectLanguageByExtension(".rs")).toBe("rust");
    expect(detectLanguageByExtension(".go")).toBe("go");
    expect(detectLanguageByExtension(".java")).toBe("java");
    expect(detectLanguageByExtension(".c")).toBe("c");
    expect(detectLanguageByExtension(".h")).toBe("c");
    expect(detectLanguageByExtension(".cpp")).toBe("cpp");
    expect(detectLanguageByExtension(".cc")).toBe("cpp");
    expect(detectLanguageByExtension(".cxx")).toBe("cpp");
    expect(detectLanguageByExtension(".hpp")).toBe("cpp");
    expect(detectLanguageByExtension(".hh")).toBe("cpp");
    expect(detectLanguageByExtension(".hxx")).toBe("cpp");
  });

  it("exposes parser URLs for every supported language", () => {
    const supportedLanguageIds = ["typescript", "javascript", "python", "rust", "go", "java", "c", "cpp"];

    for (const languageId of supportedLanguageIds) {
      expect(isSupportedLanguage(languageId)).toBe(true);
      const config = getSupportedLanguageConfig(languageId);
      expect(config).not.toBeNull();
      expect(config?.wasmUrl).toMatch(/^https:\/\//);
    }

    const javascriptConfig = getSupportedLanguageConfig("javascript");
    expect(javascriptConfig?.wasmUrl).toBe(
      "https://github.com/tree-sitter/tree-sitter-javascript/releases/download/v0.25.0/tree-sitter-javascript.wasm",
    );
  });

  it("returns null/false for unsupported language identifiers and extensions", () => {
    expect(isSupportedLanguage("ruby")).toBe(false);
    expect(getSupportedLanguageConfig("ruby")).toBeNull();
    expect(detectLanguageByExtension(".rb")).toBeNull();
    expect(isSupportedSourceExtension(".rb")).toBe(false);
  });

  it("returns extension set used by watch and graph resolution", () => {
    const extensions = getSupportedSourceExtensions();
    expect(extensions).toEqual(
      expect.arrayContaining([
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".py",
        ".rs",
        ".go",
        ".java",
        ".c",
        ".h",
        ".cpp",
        ".cc",
        ".cxx",
        ".hpp",
        ".hh",
        ".hxx",
      ]),
    );
  });

  it("prioritizes JS-family extensions for extensionless resolution in JS-family files", () => {
    expect(getResolutionExtensionsForFile("/repo/src/entry.js")).toEqual([
      ".js",
      ".mjs",
      ".cjs",
      ".jsx",
      ".ts",
      ".tsx",
    ]);

    expect(getResolutionExtensionsForFile("/repo/src/entry.ts")).toEqual([
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
    ]);
  });
});

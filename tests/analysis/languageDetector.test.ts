import { describe, expect, it } from "vitest";

import { detectLanguage } from "../../src/analysis/languageDetector.js";

describe("detectLanguage", () => {
  it("maps supported extensions to language keys", () => {
    expect(detectLanguage("/tmp/file.ts")).toBe("typescript");
    expect(detectLanguage("/tmp/file.tsx")).toBe("typescript");
    expect(detectLanguage("/tmp/file.js")).toBe("javascript");
    expect(detectLanguage("/tmp/file.jsx")).toBe("javascript");
    expect(detectLanguage("/tmp/file.mjs")).toBe("javascript");
    expect(detectLanguage("/tmp/file.cjs")).toBe("javascript");
    expect(detectLanguage("/tmp/file.py")).toBe("python");
    expect(detectLanguage("/tmp/file.rs")).toBe("rust");
    expect(detectLanguage("/tmp/file.go")).toBe("go");
    expect(detectLanguage("/tmp/file.java")).toBe("java");
    expect(detectLanguage("/tmp/file.c")).toBe("c");
    expect(detectLanguage("/tmp/file.h")).toBe("c");
    expect(detectLanguage("/tmp/file.cpp")).toBe("cpp");
    expect(detectLanguage("/tmp/file.cc")).toBe("cpp");
    expect(detectLanguage("/tmp/file.cxx")).toBe("cpp");
    expect(detectLanguage("/tmp/file.hpp")).toBe("cpp");
    expect(detectLanguage("/tmp/file.hh")).toBe("cpp");
    expect(detectLanguage("/tmp/file.hxx")).toBe("cpp");
  });

  it("returns null for unsupported extensions", () => {
    expect(detectLanguage("/tmp/file.md")).toBeNull();
    expect(detectLanguage("/tmp/file")).toBeNull();
  });
});

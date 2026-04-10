import { describe, it, expect } from "vitest";
import { isExactWordMatch } from "../../src/search/keywordSearch.js";

describe("isExactWordMatch", () => {
  it("returns true when keyword matches a word segment delimited by slash", () => {
    expect(isExactWordMatch("src/foo.ts", "foo")).toBe(true);
  });

  it("returns true when keyword matches a word segment delimited by dot", () => {
    expect(isExactWordMatch("cache.manager", "cache")).toBe(true);
  });

  it("returns false when keyword is only a partial word with no delimiter boundary", () => {
    expect(isExactWordMatch("cacheManager", "cache")).toBe(false);
  });
});

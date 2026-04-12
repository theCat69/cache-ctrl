import { describe, it, expect } from "vitest";
import { isExactWordMatch, rankResults, scoreEntry } from "../../src/search/keywordSearch.js";
import type { CacheEntry } from "../../src/types/cache.js";

function makeEntry(file: string, subject: string, description: string): CacheEntry {
  return {
    file,
    agent: "external",
    subject,
    description,
    fetched_at: "2026-04-01T00:00:00Z",
  };
}

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

  it("treats hyphen as a word delimiter", () => {
    expect(isExactWordMatch("my-lib", "lib")).toBe(true);
  });

  it("treats underscore as a word delimiter", () => {
    expect(isExactWordMatch("my_lib", "lib")).toBe(true);
  });
});

describe("scoreEntry", () => {
  it("scores subject match higher than description-only match", () => {
    const subjectHit = makeEntry("/tmp/a.json", "angular docs", "framework docs");
    const descriptionHit = makeEntry("/tmp/b.json", "framework docs", "angular docs");

    const subjectScore = scoreEntry(subjectHit, ["angular"]);
    const descriptionScore = scoreEntry(descriptionHit, ["angular"]);

    expect(subjectScore).toBe(70);
    expect(descriptionScore).toBe(30);
    expect(subjectScore).toBeGreaterThan(descriptionScore);
  });

  it("increases total score when multiple keywords match", () => {
    const entry = makeEntry(
      "/tmp/entry.json",
      "angular routing guide",
      "angular routing and forms tutorial",
    );

    const singleKeyword = scoreEntry(entry, ["angular"]);
    const twoKeywords = scoreEntry(entry, ["angular", "routing"]);

    expect(singleKeyword).toBe(70);
    expect(twoKeywords).toBe(140);
    expect(twoKeywords).toBeGreaterThan(singleKeyword);
  });

  it("returns 0 when no keyword matches subject or description", () => {
    const entry = makeEntry("/tmp/entry.json", "framework guide", "typed cache metadata");

    const score = scoreEntry(entry, ["angular"]);

    expect(score).toBe(0);
  });
});

describe("rankResults", () => {
  it("returns entries sorted by score descending", () => {
    const exactStem = makeEntry("/tmp/angular.json", "misc", "desc");
    const subjectOnly = makeEntry("/tmp/other.json", "angular topic", "desc");
    const descriptionOnly = makeEntry("/tmp/third.json", "misc", "angular appears here");

    const ranked = rankResults([descriptionOnly, subjectOnly, exactStem], ["angular"]);

    expect(ranked.map((entry) => entry.subject)).toEqual(["misc", "angular topic", "misc"]);
    expect(ranked.map((entry) => entry.score)).toEqual([100, 70, 30]);
  });

  it("uses deterministic tie-breaking via stable input order", () => {
    const first = makeEntry("/tmp/first.json", "alpha", "shared keyword");
    const second = makeEntry("/tmp/second.json", "beta", "shared keyword");

    const ranked = rankResults([first, second], ["shared"]);

    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.subject).toBe("alpha");
    expect(ranked[1]?.subject).toBe("beta");
    expect(ranked.map((entry) => entry.score)).toEqual([30, 30]);
  });
});

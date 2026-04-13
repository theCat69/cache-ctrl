import { describe, expect, it } from "vitest";

import type { DependencyGraph } from "../../src/analysis/graphBuilder.js";
import { computePageRank, normalizeRanks } from "../../src/analysis/pageRank.js";

function getRank(scores: Map<string, number>, node: string): number {
  return scores.get(node) ?? 0;
}

describe("computePageRank", () => {
  it("ranks sink-like central targets higher in a simple graph", () => {
    const graph: DependencyGraph = new Map([
      ["A", { deps: ["B", "C"], defs: [] }],
      ["B", { deps: ["C"], defs: [] }],
      ["C", { deps: [], defs: [] }],
    ]);

    const scores = computePageRank(graph);

    expect(getRank(scores, "C")).toBeGreaterThan(getRank(scores, "A"));
  });

  it("seed personalization increases relevance for seed files and their neighbors", () => {
    const graph: DependencyGraph = new Map([
      ["A", { deps: ["B"], defs: [] }],
      ["B", { deps: ["C"], defs: [] }],
      ["C", { deps: [], defs: [] }],
      ["D", { deps: [], defs: [] }],
    ]);

    const baseline = computePageRank(graph);
    const seeded = computePageRank(graph, { seedFiles: ["A"] });

    expect(getRank(seeded, "A")).toBeGreaterThan(getRank(baseline, "A"));
    expect(getRank(seeded, "B")).toBeGreaterThan(getRank(baseline, "B"));
  });

  it("returns normalized scores that sum to one", () => {
    const graph: DependencyGraph = new Map([
      ["A", { deps: ["B"], defs: [] }],
      ["B", { deps: ["A"], defs: [] }],
      ["C", { deps: [], defs: [] }],
    ]);

    const scores = computePageRank(graph);
    const total = [...scores.values()].reduce((sum, value) => sum + value, 0);

    expect(total).toBeCloseTo(1, 8);
  });

  it("falls back to uniform ranks when normalization total is non-positive", () => {
    const degenerateRanks = new Map<string, number>([["A", 0]]);

    const scores = normalizeRanks(degenerateRanks);

    expect(scores.get("A")).toBe(1);
  });
});

# Personalized PageRank on a dependency graph with dangling-node redistribution

## Pattern: personalized vector + reverse links + convergence loop

`pageRank.ts` demonstrates a reusable ranking pattern for directed graphs:
1. Build in-links once (reverse adjacency)
2. Support optional seed-based personalization
3. Redistribute dangling-node rank mass evenly each iteration
4. Normalize final scores so total rank is exactly 1

```typescript
// src/analysis/pageRank.ts

export function computePageRank(graph: DependencyGraph, options?: PageRankOptions): Map<string, number> {
  const nodes = [...graph.keys()];
  if (nodes.length === 0) return new Map();

  const dampingFactor = options?.dampingFactor ?? 0.85;
  const maxIterations = options?.maxIterations ?? 100;
  const tolerance = options?.tolerance ?? 1e-6;

  const personalization = buildPersonalizationVector(nodes, options?.seedFiles);
  const inLinks = buildInLinks(graph, nodes);

  let ranks = new Map(nodes.map((node) => [node, 1 / nodes.length]));

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const danglingRank = computeDanglingRank(graph, ranks);
    const danglingContribution = dampingFactor * (danglingRank / nodes.length);

    const nextRanks = new Map<string, number>();
    let totalDelta = 0;

    for (const node of nodes) {
      const incomingNodes = inLinks.get(node) ?? [];
      let incomingContribution = 0;

      for (const sourceNode of incomingNodes) {
        const sourceRank = ranks.get(sourceNode) ?? 0;
        const outDegree = graph.get(sourceNode)?.deps.length ?? 0;
        if (outDegree > 0) incomingContribution += sourceRank / outDegree;
      }

      const personalWeight = personalization.get(node) ?? 0;
      const rank =
        (1 - dampingFactor) * personalWeight +
        dampingFactor * incomingContribution +
        danglingContribution;

      nextRanks.set(node, rank);
      totalDelta += Math.abs(rank - (ranks.get(node) ?? 0));
    }

    ranks = nextRanks;
    if (totalDelta < tolerance) break;
  }

  return normalizeRanks(ranks);
}
```

## Key rules

- Use a personalization vector of only valid graph nodes
- Handle dangling nodes explicitly or rank mass disappears
- Stop on either convergence (`totalDelta < tolerance`) or max iterations
- Normalize final output to protect against floating-point drift

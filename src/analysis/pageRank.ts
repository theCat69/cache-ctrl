import type { DependencyGraph } from "./graphBuilder.js";

/** Tuning options for dependency-graph PageRank computation. */
export interface PageRankOptions {
  /** Damping factor (default 0.85) */
  dampingFactor?: number;
  /** Max iterations (default 100) */
  maxIterations?: number;
  /** Convergence threshold (default 1e-6) */
  tolerance?: number;
  /** Files to use as personalization seeds (boosts their rank and neighbors) */
  seedFiles?: string[];
}

/**
 * Compute Personalized PageRank over a dependency graph.
 * Returns a map of file path → rank score (normalized, sums to 1.0).
 * Higher rank = more central / more relevant to seed files.
 */
export function computePageRank(
  graph: DependencyGraph,
  options?: PageRankOptions,
): Map<string, number> {
  const nodes = [...graph.keys()];
  const nodeCount = nodes.length;

  if (nodeCount === 0) {
    return new Map();
  }

  const dampingFactor = options?.dampingFactor ?? 0.85;
  const maxIterations = options?.maxIterations ?? 100;
  const tolerance = options?.tolerance ?? 1e-6;

  const personalization = buildPersonalizationVector(nodes, options?.seedFiles);
  const inLinks = buildInLinks(graph, nodes);

  let ranks = new Map<string, number>();
  const initialRank = 1 / nodeCount;
  for (const node of nodes) {
    ranks.set(node, initialRank);
  }

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const danglingRank = computeDanglingRank(graph, ranks);
    const danglingContribution = dampingFactor * (danglingRank / nodeCount);

    const nextRanks = new Map<string, number>();
    let totalDelta = 0;

    for (const node of nodes) {
      const incomingNodes = inLinks.get(node) ?? [];
      let incomingContribution = 0;

      for (const sourceNode of incomingNodes) {
        const sourceRank = ranks.get(sourceNode);
        if (sourceRank === undefined) {
          continue;
        }

        const outDegree = graph.get(sourceNode)?.deps.length ?? 0;
        if (outDegree > 0) {
          incomingContribution += sourceRank / outDegree;
        }
      }

      const personalWeight = personalization.get(node) ?? 0;
      const rank = (1 - dampingFactor) * personalWeight + dampingFactor * incomingContribution + danglingContribution;
      nextRanks.set(node, rank);

      const previousRank = ranks.get(node) ?? 0;
      totalDelta += Math.abs(rank - previousRank);
    }

    ranks = nextRanks;

    if (totalDelta < tolerance) {
      break;
    }
  }

  return normalizeRanks(ranks);
}

function buildInLinks(graph: DependencyGraph, nodes: string[]): Map<string, string[]> {
  const inLinks = new Map<string, string[]>();
  for (const node of nodes) {
    inLinks.set(node, []);
  }

  for (const [sourceNode, graphNode] of graph.entries()) {
    for (const targetNode of graphNode.deps) {
      const targetInLinks = inLinks.get(targetNode);
      if (targetInLinks) {
        targetInLinks.push(sourceNode);
      }
    }
  }

  return inLinks;
}

function buildPersonalizationVector(nodes: string[], seedFiles: string[] | undefined): Map<string, number> {
  const vector = new Map<string, number>();

  const seedSet = new Set(seedFiles ?? []);
  const validSeeds = nodes.filter((node) => seedSet.has(node));

  if (validSeeds.length > 0) {
    const seedWeight = 1 / validSeeds.length;
    for (const node of nodes) {
      vector.set(node, 0);
    }
    for (const seed of validSeeds) {
      vector.set(seed, seedWeight);
    }
    return vector;
  }

  const uniformWeight = 1 / nodes.length;
  for (const node of nodes) {
    vector.set(node, uniformWeight);
  }
  return vector;
}

function computeDanglingRank(graph: DependencyGraph, ranks: Map<string, number>): number {
  let danglingRank = 0;

  for (const [node, graphNode] of graph.entries()) {
    if (graphNode.deps.length > 0) {
      continue;
    }
    danglingRank += ranks.get(node) ?? 0;
  }

  return danglingRank;
}

function normalizeRanks(ranks: Map<string, number>): Map<string, number> {
  let totalRank = 0;
  for (const value of ranks.values()) {
    totalRank += value;
  }

  if (totalRank <= 0) {
    const normalized = new Map<string, number>();
    const size = ranks.size;
    if (size === 0) {
      return normalized;
    }
    const uniformRank = 1 / size;
    for (const node of ranks.keys()) {
      normalized.set(node, uniformRank);
    }
    return normalized;
  }

  const normalized = new Map<string, number>();
  for (const [node, value] of ranks.entries()) {
    normalized.set(node, value / totalRank);
  }
  return normalized;
}

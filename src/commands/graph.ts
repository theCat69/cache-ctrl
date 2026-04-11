import { computePageRank } from "../analysis/pageRank.js";
import { findRepoRoot, readCache } from "../cache/cacheManager.js";
import { resolveGraphCachePath } from "../cache/graphCache.js";
import { GraphCacheFileSchema } from "../types/cache.js";
import { ErrorCode, type Result } from "../types/result.js";
import type { DependencyGraph } from "../analysis/graphBuilder.js";
import type { GraphArgs, GraphResult } from "../types/commands.js";
import { toUnknownResult } from "../utils/errors.js";

interface RankedFileEntry {
  path: string;
  rank: number;
  deps: string[];
  defs: string[];
  ref_count: number;
}

function estimateEntryTokens(entry: RankedFileEntry): number {
  return Math.ceil(JSON.stringify(entry).length / 4);
}

function countReferences(graph: DependencyGraph): Map<string, number> {
  const refCounts = new Map<string, number>();

  for (const nodePath of graph.keys()) {
    refCounts.set(nodePath, 0);
  }

  for (const graphNode of graph.values()) {
    const uniqueDeps = new Set(graphNode.deps);
    for (const depPath of uniqueDeps) {
      if (!refCounts.has(depPath)) {
        continue;
      }
      const currentCount = refCounts.get(depPath) ?? 0;
      refCounts.set(depPath, currentCount + 1);
    }
  }

  return refCounts;
}

export async function graphCommand(args: GraphArgs): Promise<Result<GraphResult["value"]>> {
  try {
    const repoRoot = await findRepoRoot(process.cwd());
    const graphPath = resolveGraphCachePath(repoRoot);

    const readResult = await readCache(graphPath);
    if (!readResult.ok) {
      if (readResult.code === ErrorCode.FILE_NOT_FOUND) {
        return {
          ok: false,
          error:
            "graph.json not found — run 'cache-ctrl watch' or wait for the background daemon to compute the graph",
          code: ErrorCode.FILE_NOT_FOUND,
        };
      }
      return readResult;
    }

    const parseResult = GraphCacheFileSchema.safeParse(readResult.value);
    if (!parseResult.success) {
      return {
        ok: false,
        error: `Malformed graph cache file: ${graphPath}`,
        code: ErrorCode.PARSE_ERROR,
      };
    }

    const parsed = parseResult.data;
    const graph: DependencyGraph = new Map(
      Object.entries(parsed.files).map(([nodePath, node]) => [
        nodePath,
        {
          deps: node.deps,
          defs: node.defs,
        },
      ]),
    );

    const refCounts = countReferences(graph);
    const ranks = computePageRank(graph, {
      ...(args.seed !== undefined ? { seedFiles: args.seed } : {}),
    });

    const rankedEntries = [...ranks.entries()]
      .map(([nodePath, rank]): RankedFileEntry => {
        const node = graph.get(nodePath);
        return {
          path: nodePath,
          rank,
          deps: node?.deps ?? [],
          defs: node?.defs ?? [],
          ref_count: refCounts.get(nodePath) ?? 0,
        };
      })
      .sort((a, b) => b.rank - a.rank);

    const tokenBudget = Math.max(64, Math.min(args.maxTokens ?? 1024, 128_000));
    let tokenEstimate = 0;
    const budgetedEntries: RankedFileEntry[] = [];

    for (const entry of rankedEntries) {
      const estimatedTokens = estimateEntryTokens(entry);
      if (tokenEstimate + estimatedTokens > tokenBudget) {
        break;
      }
      budgetedEntries.push(entry);
      tokenEstimate += estimatedTokens;
    }

    return {
      ok: true,
      value: {
        ranked_files: budgetedEntries,
        total_files: graph.size,
        computed_at: parsed.computed_at,
        token_estimate: tokenEstimate,
      },
    };
  } catch (err) {
    return toUnknownResult(err);
  }
}

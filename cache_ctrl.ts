import { tool } from "@opencode-ai/plugin";
import { listCommand } from "./src/commands/list.js";
import { inspectCommand } from "./src/commands/inspect.js";
import { invalidateCommand } from "./src/commands/invalidate.js";
import { checkFreshnessCommand } from "./src/commands/checkFreshness.js";
import { checkFilesCommand } from "./src/commands/checkFiles.js";
import { searchCommand } from "./src/commands/search.js";
import { writeLocalCommand } from "./src/commands/writeLocal.js";
import { writeExternalCommand } from "./src/commands/writeExternal.js";
import { graphCommand } from "./src/commands/graph.js";
import { mapCommand } from "./src/commands/map.js";
import { toUnknownResult } from "./src/utils/errors.js";
import { rejectTraversalKeys } from "./src/utils/traversal.js";

const z = tool.schema;

const AgentRequiredSchema = z.enum(["external", "local"]);

function withServerTime(result: unknown): string {
  const base = result !== null && typeof result === "object" ? result : {};
  return JSON.stringify({ ...base, server_time: new Date().toISOString() });
}

function handleUnknownError(err: unknown): string {
  return withServerTime(toUnknownResult(err));
}

export const search = tool({
  description: "Search all cache entries by keyword. Returns ranked list with agent type, subject, description, and staleness info.",
  args: {
    keywords: z.array(z.string().min(1)).min(1),
  },
  async execute(args) {
    try {
      const result = await searchCommand({ keywords: args.keywords });
      return withServerTime(result);
    } catch (err) {
      return handleUnknownError(err);
    }
  },
});

export const list = tool({
  description: "List all cache entries for the given agent type (external, local, or all) with age and staleness flags.",
  args: {
    agent: z.enum(["external", "local", "all"]).optional().default("all"),
  },
  async execute(args) {
    try {
      const result = await listCommand({ agent: args.agent });
      return withServerTime(result);
    } catch (err) {
      return handleUnknownError(err);
    }
  },
});

export const inspect = tool({
  description:
    "Return the full content of a specific cache entry identified by agent type and subject keyword. For local cache: prefer filter (path keyword), folder (recursive prefix), or search_facts (content keyword) for targeted results. Omitting all three returns the entire facts map — only appropriate for codebases with ≤ ~20 tracked files.",
  args: {
    agent: AgentRequiredSchema,
    subject: z.string().min(1),
    filter: z.array(z.string()).optional(),
    folder: z.string().min(1).max(256).optional(), // maps directly to InspectArgs.folder
    search_facts: z.array(z.string().min(1)).min(1).optional(), // maps to InspectArgs.searchFacts (camelCase in TypeScript layer)
  },
  async execute(args) {
    try {
      const result = await inspectCommand({
        agent: args.agent,
        subject: args.subject,
        ...(args.filter !== undefined ? { filter: args.filter } : {}),
        ...(args.folder !== undefined ? { folder: args.folder } : {}),
        ...(args.search_facts !== undefined ? { searchFacts: args.search_facts } : {}),
      });
      return withServerTime(result);
    } catch (err) {
      return handleUnknownError(err);
    }
  },
});

export const invalidate = tool({
  description: "Mark a cache entry as stale by zeroing its timestamp. The entry content is preserved. Agent should re-fetch on next run.",
  args: {
    agent: AgentRequiredSchema,
    subject: z.string().optional(),
  },
  async execute(args) {
    try {
      const result = await invalidateCommand({
        agent: args.agent,
        ...(args.subject !== undefined ? { subject: args.subject } : {}),
      });
      return withServerTime(result);
    } catch (err) {
      return handleUnknownError(err);
    }
  },
});

export const check_freshness = tool({
  description: "For external cache: send HTTP HEAD requests to all source URLs and return freshness status per URL.",
  args: {
    subject: z.string().min(1),
    url: z.string().url().optional(),
  },
  async execute(args) {
    try {
      const result = await checkFreshnessCommand({
        subject: args.subject,
        ...(args.url !== undefined ? { url: args.url } : {}),
      });
      return withServerTime(result);
    } catch (err) {
      return handleUnknownError(err);
    }
  },
});

export const check_files = tool({
  description:
    "For local cache: compare tracked files against stored mtime/hash values and return which files changed. Also reports new_files (files not excluded by .gitignore that are absent from cache — includes both git-tracked and untracked-non-ignored files) and deleted_git_files (git-tracked files deleted from working tree).",
  args: {},
  async execute(_args) {
    try {
      const result = await checkFilesCommand();
      return withServerTime(result);
    } catch (err) {
      return handleUnknownError(err);
    }
  },
});

export const write_local = tool({
  description:
    "Write a validated local cache entry. timestamp is auto-set to current UTC time — do not include it in content. tracked_files entries need only { path }; mtime/hash are computed by the command. Uses per-path merge and evicts entries for files deleted from disk.",
  args: {
    topic: z.string(),
    description: z.string(),
    tracked_files: z.array(z.object({ path: z.string() })),
    global_facts: z.array(z.string().max(300)).max(20).optional(),
    facts: z
      .record(
        z.string(),
        z.object({
          summary: z.string().optional(),
          role: z.string().optional(),
          importance: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
          facts: z.array(z.string()).optional(),
        }),
      )
      .superRefine(rejectTraversalKeys)
      .optional(),
    cache_miss_reason: z.string().optional(),
  },
  async execute(args) {
    try {
      const result = await writeLocalCommand({
        agent: "local",
        content: {
          topic: args.topic,
          description: args.description,
          tracked_files: args.tracked_files,
          ...(args.global_facts !== undefined ? { global_facts: args.global_facts } : {}),
          ...(args.facts !== undefined ? { facts: args.facts } : {}),
          ...(args.cache_miss_reason !== undefined ? { cache_miss_reason: args.cache_miss_reason } : {}),
        },
      });
      return withServerTime(result);
    } catch (err) {
      return handleUnknownError(err);
    }
  },
});

export const write_external = tool({
  description:
    "Write a validated external cache entry to disk. Uses atomic write-with-merge so unknown fields are preserved.",
  args: {
    subject: z.string(),
    description: z.string(),
    fetched_at: z.string().datetime(),
    sources: z.array(
      z.object({
        type: z.string(),
        url: z.string(),
        version: z.string().optional(),
      }),
    ),
    header_metadata: z.record(
      z.string(),
      z.object({
        etag: z.string().optional(),
        last_modified: z.string().optional(),
        checked_at: z.string(),
        status: z.enum(["fresh", "stale", "unchecked"]),
      }),
    ),
  },
  async execute(args) {
    try {
      const result = await writeExternalCommand({
        agent: "external",
        subject: args.subject,
        content: {
          description: args.description,
          fetched_at: args.fetched_at,
          sources: args.sources,
          header_metadata: args.header_metadata,
        },
      });
      return withServerTime(result);
    } catch (err) {
      return handleUnknownError(err);
    }
  },
});

export const graph = tool({
  description:
    "Return a PageRank-ranked file dependency graph within a token budget. Use this to understand which files are most central to recent changes. Reads from the pre-computed graph.json updated by 'cache-ctrl watch'.",
  args: {
    maxTokens: z.number().optional().describe("Token budget for the response (default: 1024)"),
    seed: z
      .array(z.string())
      .optional()
      .describe("File paths to personalize PageRank toward (e.g. recently changed files)"),
  },
  async execute(args) {
    try {
      const result = await graphCommand({
        ...(args.maxTokens !== undefined ? { maxTokens: args.maxTokens } : {}),
        ...(args.seed !== undefined ? { seed: args.seed } : {}),
      });
      return withServerTime(result);
    } catch (err) {
      return handleUnknownError(err);
    }
  },
});

export const map = tool({
  description:
    "Return a semantic mental map of the codebase from the local context cache. Use 'overview' (default) for a ~300-token summary of what each file does. Use 'modules' to see logical groupings. Use 'full' to include all per-file facts.",
  args: {
    depth: z
      .enum(["overview", "modules", "full"])
      .optional()
      .describe("Map depth (default: 'overview')"),
    folder: z.string().optional().describe("Restrict map to files under this path prefix"),
  },
  async execute(args) {
    try {
      const result = await mapCommand({
        ...(args.depth !== undefined ? { depth: args.depth } : {}),
        ...(args.folder !== undefined ? { folder: args.folder } : {}),
      });
      return withServerTime(result);
    } catch (err) {
      return handleUnknownError(err);
    }
  },
});

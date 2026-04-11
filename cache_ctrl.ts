import { tool } from "@opencode-ai/plugin";
import { listCommand } from "./src/commands/list.js";
import { inspectCommand } from "./src/commands/inspect.js";
import { invalidateCommand } from "./src/commands/invalidate.js";
import { checkFreshnessCommand } from "./src/commands/checkFreshness.js";
import { checkFilesCommand } from "./src/commands/checkFiles.js";
import { searchCommand } from "./src/commands/search.js";
import { writeCommand } from "./src/commands/write.js";
import { graphCommand } from "./src/commands/graph.js";
import { mapCommand } from "./src/commands/map.js";
import { ErrorCode } from "./src/types/result.js";

const z = tool.schema;

const AgentRequiredSchema = z.enum(["external", "local"]);

function withServerTime(result: unknown): string {
  const base = result !== null && typeof result === "object" ? result : {};
  return JSON.stringify({ ...base, server_time: new Date().toISOString() });
}

function handleUnknownError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return withServerTime({ ok: false, error: message, code: ErrorCode.UNKNOWN });
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

export const write = tool({
  description:
    "Write a validated cache entry to disk. Validates the content object against the ExternalCacheFile or LocalCacheFile schema before writing. Returns VALIDATION_ERROR if required fields are missing or have wrong types. For 'external': subject arg is required and must match content.subject (or will be injected if absent). For 'local': omit subject; timestamp is auto-set to current UTC time — do not include it in content. In tracked_files, each entry needs only { path } — mtime and hash are auto-computed by the tool; any caller-provided mtime or hash values are stripped. For local: uses per-path merge — tracked_files entries are merged by path (submitted paths replace existing entries for those paths; other paths are preserved). Entries for files no longer present on disk are evicted automatically. On cold start (no existing cache), submit all relevant files. On subsequent writes, submit only new and changed files. For 'external': uses atomic write-with-merge — existing unknown fields in the file are preserved. Call cache_ctrl_schema or read the skill to see required fields before calling this.",
  args: {
    agent: AgentRequiredSchema,
    subject: z.string().min(1).optional(),
    content: z.record(z.string(), z.unknown()),
  },
  async execute(args) {
    try {
      const result = await writeCommand({
        agent: args.agent,
        ...(args.subject !== undefined ? { subject: args.subject } : {}),
        content: args.content,
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

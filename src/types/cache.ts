import { z } from "zod";

export type AgentType = "external" | "local";

export interface CacheEntry {
  file: string;
  agent: AgentType;
  subject: string;
  description?: string;
  fetched_at: string;
  score?: number;
}

const SourceSchema = z.object({
  type: z.string(),
  url: z.string(),
  version: z.string().optional(),
});

const HeaderMetaSchema = z.object({
  etag: z.string().optional(),
  last_modified: z.string().optional(),
  checked_at: z.string(),
  // "unchecked" = entry written without HTTP check
  status: z.enum(["fresh", "stale", "unchecked"]),
});

export type HeaderMeta = z.infer<typeof HeaderMetaSchema>;

export const ExternalCacheFileSchema = z.looseObject({
  subject: z.string(),
  description: z.string(),
  fetched_at: z.string(),
  sources: z.array(SourceSchema),
  header_metadata: z.record(z.string(), HeaderMetaSchema),
});

export const TrackedFileSchema = z.object({
  path: z.string(),
  mtime: z.number(),
  hash: z.string().optional(),
});

const FileFactsSchema = z.object({
  summary: z.string().max(300).optional(),
  role: z
    .enum(["entry-point", "interface", "implementation", "test", "config"])
    .optional(),
  importance: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  facts: z.array(z.string().max(300)).max(10).optional(),
});

/**
 * Zod schema for the local context-gatherer cache file (`context.json`).
 *
 * Uses `z.looseObject()` so that unknown fields written by agents are preserved
 * unchanged through atomic read-modify-write merges.
 *
 * Size constraints enforced at write time:
 * - `global_facts`: max 20 entries; each string ≤ 300 characters.
 *   For cross-cutting structural observations only (e.g. repo layout, toolchain).
 * - `facts`: per-file structured metadata with max 10 concise fact strings
 *   (each string ≤ 300 characters).
 */
export const LocalCacheFileSchema = z.looseObject({
  timestamp: z.string(),
  topic: z.string(),
  description: z.string(),
  cache_miss_reason: z.string().optional(),
  tracked_files: z.array(TrackedFileSchema),
  global_facts: z
    .array(
      z.string().max(300, {
        message:
          "global facts must be concise cross-cutting observations (max 300 chars)",
      }),
    )
    .max(20, {
      message:
        "max 20 global facts — choose only cross-cutting structural observations",
    })
    .optional(),
  facts: z.record(z.string(), FileFactsSchema).optional(),
  modules: z.record(z.string(), z.array(z.string())).optional(),
});

export type TrackedFile = z.infer<typeof TrackedFileSchema>;
export type FileFacts = z.infer<typeof FileFactsSchema>;
export type ExternalCacheFile = z.infer<typeof ExternalCacheFileSchema>;
export type LocalCacheFile = z.infer<typeof LocalCacheFileSchema>;

const GraphNodeSchema = z.object({
  rank: z.number(),
  deps: z.array(z.string()),
  defs: z.array(z.string()),
});

export const GraphCacheFileSchema = z.object({
  files: z.record(z.string(), GraphNodeSchema),
  computed_at: z.string(),
});

export type GraphCacheFile = z.infer<typeof GraphCacheFileSchema>;

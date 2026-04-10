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
  status: z.enum(["fresh", "stale", "unchecked"]),
});

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

/**
 * Zod schema for the local context-gatherer cache file (`context.json`).
 *
 * Uses `z.looseObject()` so that unknown fields written by agents are preserved
 * unchanged through atomic read-modify-write merges.
 *
 * Size constraints enforced at write time:
 * - `global_facts`: max 20 entries; each string ≤ 300 characters.
 *   For cross-cutting structural observations only (e.g. repo layout, toolchain).
 * - `facts`: max 30 entries per file path; each string ≤ 800 characters.
 *   Facts must be concise observations — not raw file content or code snippets.
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
  facts: z
    .record(
      z.string(),
      z
        .array(
          z.string().max(800, {
            message:
              "write concise observations, not file content (max 800 chars per fact)",
          }),
        )
        .max(30, {
          message:
            "max 30 facts per file — choose the most architecturally meaningful observations",
        }),
    )
    .optional(),
});

export type TrackedFile = z.infer<typeof TrackedFileSchema>;
export type ExternalCacheFile = z.infer<typeof ExternalCacheFileSchema>;
export type LocalCacheFile = z.infer<typeof LocalCacheFileSchema>;

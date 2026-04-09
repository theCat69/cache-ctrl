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

export const LocalCacheFileSchema = z.looseObject({
  timestamp: z.string(),
  topic: z.string(),
  description: z.string(),
  cache_miss_reason: z.string().optional(),
  tracked_files: z.array(TrackedFileSchema),
  global_facts: z.array(z.string()).optional(),
  facts: z.record(z.string(), z.array(z.string())).optional(),
});

export type TrackedFile = z.infer<typeof TrackedFileSchema>;
export type ExternalCacheFile = z.infer<typeof ExternalCacheFileSchema>;
export type LocalCacheFile = z.infer<typeof LocalCacheFileSchema>;

import type { AgentType, ExternalCacheFile, LocalCacheFile } from "./cache.js";

// ── list ──────────────────────────────────────────────────────────────────────

export interface ListArgs {
  agent?: AgentType | "all";
}

export interface ListEntry {
  file: string;
  agent: AgentType;
  subject: string;
  description?: string;
  fetched_at: string;
  age_human: string;
  is_stale: boolean;
}

export type ListResult = { ok: true; value: ListEntry[] };

// ── inspect ───────────────────────────────────────────────────────────────────

export interface InspectArgs {
  agent: AgentType;
  subject: string;
  /** Path-keyword filter for local agent. Only facts entries whose file path contains
   *  at least one keyword (case-insensitive substring) are included. global_facts is
   *  always included. Ignored for external agent. */
  filter?: string[];
  /** Recursive folder prefix filter for local agent. Only facts entries whose file path
   *  equals the normalized folder or starts with `<normalizedFolder>/` are included.
   *  global_facts is always included. INVALID_ARGS if used with external agent. */
  folder?: string;
  /** Fact-content keyword filter for local agent. Only facts entries where at least one
   *  fact string contains at least one keyword (case-insensitive OR) are included.
   *  Silently ignored for external agent by design — external cache entries have no facts
   *  map. Use `folder` if you need to guard against passing search-facts to external; note
   *  that `folder` is an error on external while this is not. */
  searchFacts?: string[];
}

export type InspectResult = {
  ok: true;
  value: (ExternalCacheFile | LocalCacheFile) & {
    file: string;
    agent: AgentType;
  };
};

// ── flush ─────────────────────────────────────────────────────────────────────

export interface FlushArgs {
  agent: AgentType | "all";
  confirm: boolean;
}

export type FlushResult = {
  ok: true;
  value: {
    deleted: string[];
    count: number;
  };
};

// ── invalidate ────────────────────────────────────────────────────────────────

export interface InvalidateArgs {
  agent: AgentType;
  subject?: string;
}

export type InvalidateResult = {
  ok: true;
  value: {
    invalidated: string[];
  };
};

// ── touch ─────────────────────────────────────────────────────────────────────

export interface TouchArgs {
  agent: AgentType;
  subject?: string;
}

export type TouchResult = {
  ok: true;
  value: {
    touched: string[];
    new_timestamp: string;
  };
};

// ── prune ─────────────────────────────────────────────────────────────────────

export interface PruneArgs {
  agent?: AgentType | "all";
  maxAge?: string;
  delete?: boolean;
}

export type PruneResult = {
  ok: true;
  value: {
    matched: Array<{ file: string; agent: AgentType; subject: string }>;
    action: "invalidated" | "deleted";
    count: number;
  };
};

// ── check-freshness ───────────────────────────────────────────────────────────

export interface CheckFreshnessArgs {
  subject: string;
  url?: string;
}

export type CheckFreshnessResult = {
  ok: true;
  value: {
    subject: string;
    sources: Array<{
      url: string;
      status: "fresh" | "stale" | "error";
      http_status?: number;
      error?: string;
    }>;
    overall: "fresh" | "stale" | "error";
  };
};

// ── check-files ───────────────────────────────────────────────────────────────

export type CheckFilesResult = {
  ok: true;
  value: {
    status: "changed" | "unchanged";
    changed_files: Array<{
      path: string;
      reason: "mtime" | "hash" | "missing";
    }>;
    unchanged_files: string[];
    missing_files: string[];
    new_files: string[];
    deleted_git_files: string[];
  };
};

// ── search ────────────────────────────────────────────────────────────────────

export interface SearchArgs {
  keywords: string[];
}

export type SearchResult = {
  ok: true;
  value: Array<{
    file: string;
    subject: string;
    description?: string;
    agent: AgentType;
    fetched_at: string;
    score: number;
  }>;
};

// ── write ─────────────────────────────────────────────────────────────────────

export interface WriteArgs {
  agent: AgentType;
  subject?: string; // required for external, unused for local
  content: Record<string, unknown>;
}

export type WriteResult = {
  ok: true;
  value: {
    file: string;
  };
};

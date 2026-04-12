import type { AgentType, ExternalCacheFile, LocalCacheFile } from "./cache.js";

// ── list ──────────────────────────────────────────────────────────────────────

/** Arguments accepted by the `list` command. */
export interface ListArgs {
  agent?: AgentType | "all";
}

/** One entry returned by the `list` command. */
export interface ListEntry {
  file: string;
  agent: AgentType;
  subject: string;
  description?: string;
  fetched_at: string;
  age_human: string;
  is_stale: boolean;
}

/** Success payload shape returned by the `list` command. */
export type ListResult = { ok: true; value: ListEntry[] };

// ── inspect ───────────────────────────────────────────────────────────────────

/**
 * Arguments accepted by the `inspect` command.
 * @remarks `agent` controls result shape: `external` returns an external entry, while
 * `local` returns local cache content with `tracked_files` removed and optional facts filters.
 */
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

/** Success payload shape returned by the `inspect` command. */
export type InspectResult = {
  ok: true;
  value: (ExternalCacheFile | Omit<LocalCacheFile, "tracked_files">) & {
    file: string;
    agent: AgentType;
  };
};

// ── flush ─────────────────────────────────────────────────────────────────────

/** Arguments accepted by the `flush` command. */
export interface FlushArgs {
  agent: AgentType | "all";
  confirm: boolean;
}

/** Success payload shape returned by the `flush` command. */
export type FlushResult = {
  ok: true;
  value: {
    deleted: string[];
    count: number;
  };
};

// ── invalidate ────────────────────────────────────────────────────────────────

/** Arguments accepted by the `invalidate` command. */
export interface InvalidateArgs {
  agent: AgentType;
  subject?: string;
}

/** Success payload shape returned by the `invalidate` command. */
export type InvalidateResult = {
  ok: true;
  value: {
    invalidated: string[];
  };
};

// ── touch ─────────────────────────────────────────────────────────────────────

/** Arguments accepted by the `touch` command. */
export interface TouchArgs {
  agent: AgentType;
  subject?: string;
}

/** Success payload shape returned by the `touch` command. */
export type TouchResult = {
  ok: true;
  value: {
    touched: string[];
    new_timestamp: string;
  };
};

// ── prune ─────────────────────────────────────────────────────────────────────

/** Arguments accepted by the `prune` command. */
export interface PruneArgs {
  agent?: AgentType | "all";
  maxAge?: string;
  delete?: boolean;
}

/** Success payload shape returned by the `prune` command. */
export type PruneResult = {
  ok: true;
  value: {
    matched: Array<{ file: string; agent: AgentType; subject: string }>;
    action: "invalidated" | "deleted";
    count: number;
  };
};

// ── check-files ───────────────────────────────────────────────────────────────

/** Success payload shape returned by the `check-files` command. */
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

/** Arguments accepted by the `search` command. */
export interface SearchArgs {
  keywords: string[];
}

/** Success payload shape returned by the `search` command. */
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

/**
 * Shared write-command input contract.
 * @remarks `agent` selects write mode: `external` requires `subject`; `local` ignores
 * `subject` and writes `context.json` using local schema semantics.
 */
export interface WriteArgs {
  agent: AgentType;
  subject?: string; // required for external, unused for local
  content: Record<string, unknown>;
}

/** Success payload shape returned by write commands. */
export type WriteResult = {
  ok: true;
  value: {
    file: string;
  };
};

// ── graph ─────────────────────────────────────────────────────────────────────

/** Arguments accepted by the `graph` command. */
export interface GraphArgs {
  maxTokens?: number;
  seed?: string[];
}

// ── watch ─────────────────────────────────────────────────────────────────────

/** Arguments accepted by the `watch` command. */
export interface WatchArgs {
  verbose?: boolean;
}

/** Success payload shape returned by the `graph` command. */
export interface GraphResult {
  value: {
    ranked_files: Array<{
      path: string;
      rank: number;
      deps: string[];
      defs: string[];
      ref_count: number;
    }>;
    total_files: number;
    computed_at: string;
    token_estimate: number;
  };
}

// ── map ───────────────────────────────────────────────────────────────────────

/** Output depth levels supported by the `map` command. */
export type MapDepth = "overview" | "modules" | "full";

/** Arguments accepted by the `map` command. */
export interface MapArgs {
  depth?: MapDepth;
  folder?: string;
}

/** Success payload shape returned by the `map` command. */
export interface MapResult {
  value: {
    depth: MapDepth;
    global_facts: string[];
    files: Array<{
      path: string;
      summary?: string;
      role?: string;
      importance?: number;
      facts?: string[];
    }>;
    modules?: Record<string, string[]>;
    total_files: number;
    folder_filter?: string;
  };
}

// ── install ───────────────────────────────────────────────────────────────────

/** Arguments accepted by the `install` command. */
export interface InstallArgs {
  configDir?: string;
}

/** Success payload shape returned by the `install` command. */
export interface InstallResult {
  toolPath: string;
  skillPaths: string[];
  configDir: string;
}

// ── version ───────────────────────────────────────────────────────────────────

/** Arguments accepted by the `version` command. */
export type VersionArgs = Record<string, never>;

/** Success payload shape returned by the `version` command. */
export type VersionResult = { value: { version: string } };

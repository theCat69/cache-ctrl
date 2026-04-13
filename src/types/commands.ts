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

// ── inspect-external / inspect-local ─────────────────────────────────────────

/** Arguments accepted by the `inspect-external` command. */
export interface InspectExternalArgs {
  /** Subject keyword used to rank and select a single external cache entry. */
  subject: string;
}

/** Arguments accepted by the `inspect-local` command. */
export interface InspectLocalArgs {
  /** Path-keyword filter; case-insensitive substring OR match against fact file paths. */
  filter?: string[];
  /** Recursive folder prefix filter for fact file paths. */
  folder?: string;
  /** Fact-content filter; case-insensitive substring OR match within fact strings. */
  searchFacts?: string[];
}

/** Success payload shape returned by the `inspect-external` command. */
export type InspectExternalResult = {
  ok: true;
  value: ExternalCacheFile & {
    file: string;
    agent: "external";
  };
};

/** Success payload shape returned by the `inspect-local` command. */
export type InspectLocalResult = {
  ok: true;
  value: Omit<LocalCacheFile, "tracked_files"> & {
    file: string;
    agent: "local";
    warning?: string;
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

/**
 * Result shapes follow command compatibility tiers: canonical `{ ok: true; value }`,
 * legacy `{ value }` payloads, and install/update/uninstall payload-only results.
 * Keep existing shapes stable to avoid breaking CLI/tool consumers.
 */

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

// ── update / uninstall ────────────────────────────────────────────────────────

/** Arguments accepted by the `update` command. */
export interface UpdateArgs {
  configDir?: string;
}

/** Success payload shape returned by the `update` command. */
export interface UpdateResult {
  packageUpdated: boolean;
  installedPaths: string[];
  warnings: string[];
}

/** Arguments accepted by the `uninstall` command. */
export interface UninstallArgs {
  configDir?: string;
}

/** Success payload shape returned by the `uninstall` command. */
export interface UninstallResult {
  removed: string[];
  packageUninstalled: boolean;
  warnings: string[];
}

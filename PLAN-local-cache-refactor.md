# Plan: Local Cache Refactor — Mental Map & Structural Graph

**Project**: `cache-ctrl` CLI + opencode plugin (TypeScript/Bun)
**Date**: 2026-04-11
**Status**: Planning — implementation specs to follow per phase

---

## 1. Background

The `local-context-gatherer` cache (`context.json`) was originally a single description blob, later extended with per-file `facts` and `global_facts` (file-linked facts, 2026-04-06). That work solved durability and delta-preservation. It did not solve navigation.

The system now has a solid foundation for storing *what agents know about files*. What it lacks is the ability to answer the question a brain agent asks first: **"What is the shape of this codebase, and where do I start?"**

---

## 2. Problem

Brain agents (orchestrators, reviewers, architects) currently have two bad options:

- **Read everything**: load all files into context. Expensive in tokens, slow, often unnecessary.
- **Read nothing**: operate blind, ask narrowly targeted questions, miss important context.

What they need is a **middle path**: a lightweight structural view of the codebase that lets them identify which files matter for a given task, then read only those.

The existing `facts + inspect-local --filter` path is a start, but it has two gaps:

1. **No topology**: facts describe individual files in isolation. There is no structural signal about how files relate to each other — which file is a central hub, which is a leaf, what depends on what.
2. **No priority signal**: all files are equal in the cache. A brain agent has no way to know that `cacheManager.ts` is the I/O hub for the entire system without reading facts for every file first.

---

## 3. Goals

1. Give brain agents a **semantic mental map** of the codebase — what each file does, its role, its importance — at a glance and within a tight token budget.
2. Give brain agents a **structural graph** — which files reference which, which are the most connected — computed programmatically, not inferred by an LLM.
3. Keep the **tool surface for agents minimal and stable**: no new agent-facing concepts beyond two new tools and one schema evolution.
4. Decouple local and external write/inspect logic into dedicated local/external commands and tools.

---

## 4. Key Decisions

| Topic | Decision | Rationale |
|---|---|---|
| Relationship extraction | Programmatic (static analysis), not LLM-inferred | LLM-inferred graphs are lossy and hard to invalidate incrementally |
| Parser | `@typescript-eslint/typescript-estree` | Pure TypeScript, zero native bindings — fits Bun's portable model |
| Graph algorithm | Personalized PageRank (Aider-inspired) | Battle-tested at scale; surfaces transitive importance, not just direct connections |
| Graph update trigger | Background daemon (`cache-ctrl watch`) | Pre-computed graph → zero-latency queries for agents |
| Graph personalization seed | `changed_files` from `check-files` | Solves the "what to query" problem without agents needing to know file names upfront |
| Tool surface | Unified `agent` param preserved; two new tools added | Protected Variations: internal split, stable external interface |
| Command layer | Internal split (`writeLocal`, `writeExternal`, `inspectLocal`, `inspectExternal`) | SRP: each agent type has diverged enough to warrant separate handlers |
| Facts limits | Tightened: 10 facts × 300 chars per file (was 30 × 800) | Forces agents to write `summary` first; discourages content dumps |
| `facts` schema | Evolves from `Record<path, string[]>` to `Record<path, FileFacts>` | Enables `summary`, `role`, `importance` without a separate parallel structure |

---

## 5. Architecture Overview

The refactor introduces four coordinated changes:

```
Brain Agent
    │
    ├── cache_ctrl_map    → "What does each file do? Where do I start?"
    │       │               (semantic, agent-written, from context.json)
    │       └── FileFacts: summary · role · importance
    │
    ├── cache_ctrl_graph  → "What depends on what? What are the most connected files?"
    │       │               (structural, programmatically computed, from graph.json)
    │       └── PageRank-ranked symbols + file dependency edges
    │
    └── cache_ctrl_inspect_local / cache_ctrl_inspect_external
            → "Tell me everything about these specific files"
            │               (unchanged — file-centric, filtered by path/folder/fact)
            └── full facts for targeted files
```

The two new tools complement each other: `map` answers *semantic* questions (purpose, role, importance); `graph` answers *structural* questions (dependencies, centrality). `inspect-local` / `inspect-external` remain the deep-dive tools.

---

## 6. What Changes

### 6.1 Schema Evolution — `FileFacts`

The `facts` field evolves from a flat `string[]` per file to a structured object. The new shape adds:

- **`summary`**: a single-sentence description of what the file does (the primary signal for brain agents)
- **`role`**: a tag — `entry-point`, `interface`, `implementation`, `test`, or `config`
- **`importance`**: an ordinal — `1` (core), `2` (supporting), `3` (peripheral)
- **`facts`**: the existing observations array, now capped at 10 × 300 chars

All new fields are optional in the schema (backward-compatible Zod change). In practice, the `local-context-gatherer` skill will require `summary` and `role` for every file it reads.

### 6.2 Semantic Tool — `cache_ctrl_map`

A new tool, topology-centric rather than file-centric.

Three depths:
- **`overview`**: global facts + all file summaries with role/importance — fits in ~300 tokens. This is the first call a brain agent makes.
- **`modules`**: same as overview plus logical module groupings (agent-inferred, stored as a top-level `modules` field in `context.json`).
- **`full`**: everything including per-file `facts[]` arrays. Use sparingly.

Supports a `folder` filter to restrict the map to a subtree.

### 6.3 Structural Tool — `cache_ctrl_graph`

A new tool, powered by a pre-computed import/reference graph and PageRank.

- Takes a `maxTokens` budget (default: 1024, matching Aider's default)
- Personalization seed: the most recently changed files (from `graph.json` change timestamps) — so the graph naturally highlights what's most relevant to recent activity
- Returns: ranked file list with definitions and reference counts, rendered as structured JSON
- Source data lives in a dedicated `graph.json` cache file alongside `context.json`

### 6.4 Background Daemon — `cache-ctrl watch`

A new command that starts a file watcher on the repo root.

- Detects file changes using Bun's native file system watching
- On change: re-extracts symbols for modified files, recomputes PageRank, updates `graph.json`
- Respects `.gitignore` exclusions
- Designed to run as a persistent background process (managed by the user or a process manager)
- Silent by default; `--verbose` logs each update

### 6.5 Internal Command Split

`write` and `inspect` logic currently handle both agent types in shared paths with branching. This will be split into dedicated handlers per agent type, with thin router functions at the top level.

The tool surface uses split inspect tools (`cache_ctrl_inspect_external`, `cache_ctrl_inspect_local`) alongside write routing.

---

## 7. Brain Agent Protocol (after refactor)

A brain agent entering a new task follows this sequence:

1. **`cache_ctrl_map(depth: "overview")`** — get the semantic mental map. Identify files by role and importance. Costs ~300 tokens.
2. **`cache_ctrl_graph(maxTokens: 1024)`** — get the structural graph. Understand which files are most connected. Identify the relevant subgraph for this task.
3. **`cache_ctrl_inspect_local(filter: [...])`** — read full facts for the specific files identified in steps 1–2.
4. **Read files in full** — only the 2–5 files that are actually needed.

This replaces "read everything" or "read blind" with a structured 4-step progressive disclosure.

---

## 8. Out of Scope

- **External cache**: no changes. It is well-designed and stable.
- **Shared operations** (`list`, `prune`, `invalidate`, `search`, `touch`): no changes. The `agent` parameter routing is already clean.
- **`check-files`**: no changes. It doesn't need unification.
- **Polyglot support**: the graph engine targets TypeScript/JavaScript only. The architecture accommodates future language support via parser abstraction, but it is not in scope.
- **Function-level or symbol-level graph display**: the graph is file-level. Symbols are used internally for ranking but the output is file-centric.
- **Cold-start recovery**: if `graph.json` or `context.json` are deleted, a rescan is required. This plan improves delta durability, not cold-start recovery.
- **Embeddings / semantic search**: not in scope. The `search` command already covers keyword-based fact search; vector search is a separate, heavier investment.

---

## 9. Implementation Sequence

Each phase is independently deliverable and testable.

| Phase | Scope | Risk |
|---|---|---|
| **1 — Schema** | Evolve `FileFacts` shape; tighten limits; add `modules` field | Low — additive Zod change |
| **2 — Command split** | Extract `writeLocal`, `writeExternal`, `inspectLocal`, `inspectExternal` | Low — pure refactor; all existing tests must pass unchanged |
| **3 — Analysis engine** | `symbolExtractor`, `graphBuilder`, `pageRank` in `src/analysis/` | Medium — new dependency (`typescript-estree`); unit-testable in isolation |
| **4 — Graph cache** | `graph.json` read/write service | Low — mirrors existing `localCache` pattern |
| **5 — `cache_ctrl_graph`** | Wire analysis engine + graph cache + PageRank into a command + tool | Medium |
| **6 — `cache_ctrl_map`** | Map command reading `context.json` at three depths | Low — reads existing data, no new writes |
| **7 — `cache-ctrl watch`** | File watcher daemon; incremental graph updates | High — process lifecycle; build last |
| **8 — Skills & agent prompts** | Update `cache-ctrl-local` skill + `local-context-gatherer` agent prompt | Low |

Phases 1 and 2 are the foundation and should be completed together before any subsequent phase begins. Phases 3–6 can be spec'd and implemented in parallel once 1–2 are stable. Phase 7 (daemon) is isolated enough to be deferred if needed.

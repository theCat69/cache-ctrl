#!/usr/bin/env bun
import { listCommand } from "./commands/list.js";
import { inspectCommand } from "./commands/inspect.js";
import { flushCommand } from "./commands/flush.js";
import { invalidateCommand } from "./commands/invalidate.js";
import { touchCommand } from "./commands/touch.js";
import { pruneCommand } from "./commands/prune.js";
import { checkFilesCommand } from "./commands/checkFiles.js";
import { searchCommand } from "./commands/search.js";
import { writeLocalCommand } from "./commands/writeLocal.js";
import { writeExternalCommand } from "./commands/writeExternal.js";
import { installCommand } from "./commands/install.js";
import { graphCommand } from "./commands/graph.js";
import { mapCommand } from "./commands/map.js";
import { watchCommand } from "./commands/watch.js";
import { versionCommand } from "./commands/version.js";
import { ErrorCode } from "./types/result.js";
import { toUnknownResult } from "./utils/errors.js";

type CommandName =
  | "list"
  | "inspect"
  | "flush"
  | "invalidate"
  | "touch"
  | "prune"
  | "check-files"
  | "search"
  | "write-local"
  | "write-external"
  | "install"
  | "graph"
  | "map"
  | "watch"
  | "version";

function isKnownCommand(cmd: string): cmd is CommandName {
  return Object.hasOwn(COMMAND_HELP as Record<string, unknown>, cmd);
}

interface CommandHelp {
  usage: string;
  description: string;
  details: string;
}

const COMMAND_HELP: Record<CommandName, CommandHelp> = {
  list: {
    usage: "list [--agent external|local|all]",
    description: "List all cache entries with age and staleness",
    details: [
      "  Arguments:",
      "    (none)",
      "",
      "  Options:",
      "    --agent external|local|all   Filter by agent type (default: all)",
      "",
      "  Output: JSON array of cache entries with timestamps and staleness flags.",
    ].join("\n"),
  },
  inspect: {
    usage: "inspect <agent> <subject-keyword> [--filter <kw>] [--folder <path>] [--search-facts <kw>]",
    description: "Show full content of a cache entry",
    details: [
      "  Arguments:",
      "    <agent>            Agent type: external or local",
      "    <subject-keyword>  Keyword used to locate the cache entry",
      "",
      "  Options:",
      "    --filter <kw>[,<kw>...]      Return only facts whose file path contains any keyword",
      "                                 (local agent only; comma-separated; case-insensitive OR match)",
      "    --folder <path>              Return only facts whose file path starts with the given folder prefix",
      "                                 (local agent only; recursive; INVALID_ARGS if used with external agent)",
      "    --search-facts <kw>[,<kw>...]  Return only facts where any fact string contains any keyword",
      "                                   (local agent only; comma-separated; case-insensitive OR match)",
      "",
      "  Output: Full JSON content of the matched cache entry.",
      "  Note: tracked_files is never returned for local agent inspect.",
      "  Note: --filter, --folder, and --search-facts are AND-ed when combined.",
    ].join("\n"),
  },
  flush: {
    usage: "flush <agent|all> --confirm",
    description: "Delete all cache entries (destructive, requires --confirm)",
    details: [
      "  Arguments:",
      "    <agent|all>   Agent to flush: external, local, or all",
      "",
      "  Options:",
      "    --confirm     Required flag — confirms the destructive operation",
      "",
      "  WARNING: This permanently deletes all matching cache entries.",
    ].join("\n"),
  },
  invalidate: {
    usage: "invalidate <agent> [subject-keyword]",
    description: "Mark cache entries as stale (content preserved)",
    details: [
      "  Arguments:",
      "    <agent>             Agent type: external or local",
      "    [subject-keyword]   Optional keyword to target a specific entry",
      "",
      "  Output: Number of entries marked as stale.",
    ].join("\n"),
  },
  touch: {
    usage: "touch <agent> [subject-keyword]",
    description: "Refresh timestamps on cache entries",
    details: [
      "  Arguments:",
      "    <agent>             Agent type: external or local",
      "    [subject-keyword]   Optional keyword to target a specific entry",
      "",
      "  Output: Number of entries whose timestamps were updated.",
    ].join("\n"),
  },
  prune: {
    usage: "prune [--agent external|local|all] [--max-age <duration>] [--delete]",
    description: "Find and optionally remove stale entries",
    details: [
      "  Arguments:",
      "    (none)",
      "",
      "  Options:",
      "    --agent external|local|all   Filter by agent type (default: all)",
      "    --max-age <duration>         Maximum age threshold (e.g. 24h, 7d)",
      "    --delete                     Actually delete the stale entries (dry-run if omitted)",
    ].join("\n"),
  },
  "check-files": {
    usage: "check-files",
    description: "Compare tracked local files against stored mtime/hash",
    details: [
      "  Arguments:",
      "    (none)",
      "",
      "  Output: List of files whose mtime or hash differs from the stored baseline.",
      "  Also reports new_files (files not excluded by .gitignore that are absent from cache — includes git-tracked and untracked-non-ignored files) and deleted_git_files.",
    ].join("\n"),
  },
  search: {
    usage: "search <keyword> [<keyword>...]",
    description: "Search cache entries by keyword (ranked results)",
    details: [
      "  Arguments:",
      "    <keyword> [<keyword>...]   One or more keywords to search for",
      "",
      "  Output: Ranked list of matching cache entries.",
    ].join("\n"),
  },
  "write-local": {
    usage: "write-local --data '<json>'",
    description: "Write a validated local cache entry",
    details: [
      "  Arguments:",
      "    (none)",
      "",
      "  Options:",
      "    --data '<json>'   JSON string containing the cache entry payload",
      "",
      "  Output: Confirmation with the written entry's key.",
    ].join("\n"),
  },
  "write-external": {
    usage: "write-external <subject> --data '<json>'",
    description: "Write a validated external cache entry",
    details: [
      "  Arguments:",
      "    <subject>   Subject identifier for the external entry",
      "",
      "  Options:",
      "    --data '<json>'   JSON string containing the cache entry payload",
      "",
      "  Output: Confirmation with the written entry's key.",
    ].join("\n"),
  },
  install: {
    usage: "install [--config-dir <path>]",
    description: "Set up OpenCode tool and skills in the user config directory",
    details: [
      "  Arguments:",
      "    (none)",
      "",
      "  Options:",
      "    --config-dir <path>  Override the OpenCode config directory (default: platform-specific)",
      "",
      "  Output: JSON object describing installed tool/skill paths.",
    ].join("\n"),
  },
  graph: {
    usage: "graph [--max-tokens <number>] [--seed <path>[,<path>...]]",
    description: "Return a PageRank-ranked dependency graph under a token budget",
    details: [
      "  Arguments:",
      "    (none)",
      "",
      "  Options:",
      "    --max-tokens <number>        Token budget for ranked_files output (default: 1024)",
      "    --seed <path>[,<path>...]    Personalize rank toward specific file path(s)",
      "                                 (repeat --seed to provide multiple values)",
      "",
      "  Output: Ranked files with deps, defs, and ref_count from graph.json.",
    ].join("\n"),
  },
  map: {
    usage: "map [--depth overview|modules|full] [--folder <path-prefix>]",
    description: "Return a semantic map of local context.json",
    details: [
      "  Arguments:",
      "    (none)",
      "",
      "  Options:",
      "    --depth overview|modules|full   Output depth (default: overview)",
      "    --folder <path-prefix>          Restrict map to files whose path starts with prefix",
      "",
      "  Output: JSON object with global_facts, files, optional modules, and total_files.",
    ].join("\n"),
  },
  watch: {
    usage: "watch [--verbose]",
    description: "Watch for file changes and recompute the dependency graph",
    details: [
      "  Arguments:",
      "    (none)",
      "",
      "  Options:",
      "    --verbose   Log watcher lifecycle and rebuild events",
      "",
      "  Output: Long-running daemon process that updates graph.json on source changes.",
    ].join("\n"),
  },
  version: {
    usage: "version",
    description: "Show the current cache-ctrl package version",
    details: [
      "  Arguments:",
      "    (none)",
      "",
      "  Output: JSON object containing the current package version.",
    ].join("\n"),
  },
};

const GLOBAL_OPTIONS_SECTION = [
  "Global options:",
  "  --help    Show help (use 'help <command>' for command-specific help)",
  "  --pretty  Pretty-print JSON output",
].join("\n");

/**
 * Writes plain-text usage information to stdout.
 *
 * @param command - If provided, prints help for that specific command.
 *                  If omitted, prints the full command reference.
 *                  Does NOT call process.exit — the caller handles exit.
 */
export function printHelp(command?: string): boolean {
  if (command === undefined) {
    const lines: string[] = [
      "Usage: cache-ctrl <command> [args] [options]",
      "",
      "Commands:",
    ];

    const maxUsageLen = Math.max(
      ...Object.values(COMMAND_HELP).map((h) => h.usage.length),
    );

    for (const help of Object.values(COMMAND_HELP)) {
      const paddedUsage = help.usage.padEnd(maxUsageLen);
      lines.push(`  ${paddedUsage}   ${help.description}`);
    }

    lines.push("", GLOBAL_OPTIONS_SECTION, "", "Run 'cache-ctrl help <command>' for command-specific help.");
    process.stdout.write(lines.join("\n") + "\n");
    return true;
  }

  if (command === "help") {
    return printHelp();
  }

  const sanitized = command.replace(/[\x00-\x1F\x7F]/g, "");

  if (!isKnownCommand(command)) {
    process.stderr.write(`Unknown command: "${sanitized}". Run 'cache-ctrl help' for available commands.\n`);
    return false;
  }

  const help = COMMAND_HELP[command];
  const lines: string[] = [
    `Usage: cache-ctrl ${help.usage}`,
    "",
    `Description: ${help.description}`,
    "",
    help.details,
    "",
    GLOBAL_OPTIONS_SECTION,
  ];
  process.stdout.write(lines.join("\n") + "\n");
  return true;
}

function printResult(value: unknown, pretty: boolean): void {
  if (pretty) {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  } else {
    process.stdout.write(JSON.stringify(value) + "\n");
  }
}

function printError(error: { ok: false; error: string; code: string }, pretty: boolean): void {
  if (pretty) {
    process.stderr.write(JSON.stringify(error, null, 2) + "\n");
  } else {
    process.stderr.write(JSON.stringify(error) + "\n");
  }
}

/**
 * Prints a structured usage error and terminates the process.
 *
 * @param message - Human-readable usage failure detail.
 * @remarks Always exits with process code `2` to distinguish usage failures from runtime errors.
 */
function usageError(message: string): never {
  process.stderr.write(JSON.stringify({ ok: false, error: message, code: ErrorCode.INVALID_ARGS }) + "\n");
  process.exit(2);
}

export { usageError };

/** Flags that consume the following token as their value. Boolean flags must NOT appear here. */
const VALUE_FLAGS = new Set([
  "data",
  "agent",
  "max-age",
  "filter",
  "folder",
  "search-facts",
  "config-dir",
  "max-tokens",
  "seed",
  "depth",
]);

function collectFlagValues(argv: string[], flagName: string): string[] {
  const values: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== `--${flagName}`) {
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined) {
      values.push(next);
      i += 1;
    }
  }

  return values;
}

/**
 * Parses raw CLI argv tokens into positional args and flag key/value pairs.
 *
 * @param argv - Raw argument tokens (typically `process.argv.slice(2)`).
 * @returns Parsed positional args and normalized flags map.
 * @remarks Flags listed in `VALUE_FLAGS` consume the following token as their value;
 * all other `--flag` tokens are treated as boolean flags.
 */
export function parseArgs(argv: string[]): { args: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (VALUE_FLAGS.has(key) && next !== undefined) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i += 1;
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }

  return { args: positional, flags };
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const { args, flags } = parseArgs(rawArgs);
  const pretty = flags.pretty === true;

  if (flags["help"] === true) {
    printHelp();
    process.exit(0);
  }

  const command = args[0];
  if (!command) {
    usageError("Usage: cache-ctrl <command> [args]. Commands: list, inspect, flush, invalidate, touch, prune, check-files, search, write-local, write-external, install, graph, map, watch, version");
  }

  switch (command) {
    case "help": {
      const ok = printHelp(args[1]);
      process.exit(ok ? 0 : 1);
      break;
    }
    case "list": {
      const agentArg = typeof flags.agent === "string" ? flags.agent : undefined;
      const validAgents: (string | undefined)[] = ["external", "local", "all", undefined];
      if (!validAgents.includes(agentArg)) {
        usageError(`Invalid --agent value: "${agentArg}". Must be external, local, or all`);
      }
      const result = await listCommand({
        ...(agentArg !== undefined ? { agent: agentArg as "external" | "local" | "all" } : {}),
      });
      if (result.ok) {
        printResult(result, pretty);
      } else {
        printError(result, pretty);
        process.exit(1);
      }
      break;
    }

    case "inspect": {
      const agent = args[1];
      const subject = args[2];
      if (!agent || !subject) {
        usageError("Usage: cache-ctrl inspect <agent> <subject-keyword>");
      }
      if (agent !== "external" && agent !== "local") {
        usageError(`Invalid agent: "${agent}". Must be external or local`);
      }
      if (flags.filter === true) {
        usageError("--filter requires a value: --filter <kw>[,<kw>...]");
      }
      if (typeof flags.folder === "string" && flags.folder.trim() === "") {
        usageError("--folder requires a non-empty value");
      }
      const filterRaw = typeof flags.filter === "string" ? flags.filter : undefined;
      const filter = filterRaw
        ? filterRaw
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean)
        : undefined;
      const folder = typeof flags.folder === "string" ? flags.folder : undefined;
      const searchFactsRaw = typeof flags["search-facts"] === "string" ? flags["search-facts"] : undefined;
      const searchFacts = searchFactsRaw
        ? searchFactsRaw
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean)
        : undefined;
      const result = await inspectCommand({
        agent,
        subject,
        ...(filter !== undefined ? { filter } : {}),
        ...(folder !== undefined ? { folder } : {}),
        ...(searchFacts !== undefined ? { searchFacts } : {}),
      });
      if (result.ok) {
        printResult(result, pretty);
      } else {
        printError(result, pretty);
        process.exit(1);
      }
      break;
    }

    case "flush": {
      const agent = args[1];
      if (!agent) {
        usageError("Usage: cache-ctrl flush <agent|all> --confirm");
      }
      if (agent !== "external" && agent !== "local" && agent !== "all") {
        usageError(`Invalid agent: "${agent}". Must be external, local, or all`);
      }
      const confirm = flags.confirm === true;
      const result = await flushCommand({ agent, confirm });
      if (result.ok) {
        printResult(result, pretty);
      } else {
        printError(result, pretty);
        process.exit(1);
      }
      break;
    }

    case "invalidate": {
      const agent = args[1];
      if (!agent) {
        usageError("Usage: cache-ctrl invalidate <agent> [subject-keyword]");
      }
      if (agent !== "external" && agent !== "local") {
        usageError(`Invalid agent: "${agent}". Must be external or local`);
      }
      const subject = args[2];
      const result = await invalidateCommand({ agent, ...(subject !== undefined ? { subject } : {}) });
      if (result.ok) {
        printResult(result, pretty);
      } else {
        printError(result, pretty);
        process.exit(1);
      }
      break;
    }

    case "touch": {
      const agent = args[1];
      if (!agent) {
        usageError("Usage: cache-ctrl touch <agent> [subject-keyword]");
      }
      if (agent !== "external" && agent !== "local") {
        usageError(`Invalid agent: "${agent}". Must be external or local`);
      }
      const subject = args[2];
      const result = await touchCommand({ agent, ...(subject !== undefined ? { subject } : {}) });
      if (result.ok) {
        printResult(result, pretty);
      } else {
        printError(result, pretty);
        process.exit(1);
      }
      break;
    }

    case "prune": {
      const agentArg = typeof flags.agent === "string" ? flags.agent : undefined;
      if (agentArg && agentArg !== "external" && agentArg !== "local" && agentArg !== "all") {
        usageError(`Invalid --agent value: "${agentArg}". Must be external, local, or all`);
      }
      const maxAge = typeof flags["max-age"] === "string" ? flags["max-age"] : undefined;
      const doDelete = flags.delete === true;
      const result = await pruneCommand({
        ...(agentArg !== undefined ? { agent: agentArg as "external" | "local" | "all" } : {}),
        ...(maxAge !== undefined ? { maxAge } : {}),
        delete: doDelete,
      });
      if (result.ok) {
        printResult(result, pretty);
      } else {
        printError(result, pretty);
        process.exit(1);
      }
      break;
    }

    case "check-files": {
      const result = await checkFilesCommand();
      if (result.ok) {
        printResult(result, pretty);
      } else {
        printError(result, pretty);
        process.exit(1);
      }
      break;
    }

    case "search": {
      const keywords = args.slice(1);
      if (keywords.length === 0) {
        usageError("Usage: cache-ctrl search <keyword> [<keyword>...]");
      }
      const result = await searchCommand({ keywords });
      if (result.ok) {
        printResult(result, pretty);
      } else {
        printError(result, pretty);
        process.exit(1);
      }
      break;
    }

    case "write-local": {
      const dataStr = typeof flags.data === "string" ? flags.data : undefined;
      if (!dataStr) {
        usageError("Usage: cache-ctrl write-local --data '<json>'");
      }
      let content: Record<string, unknown>;
      try {
        content = JSON.parse(dataStr) as Record<string, unknown>; // JSON.parse returns any; writeLocalCommand validates the payload shape via Zod before use.
      } catch {
        usageError("--data must be valid JSON");
      }
      if (typeof content !== "object" || content === null || Array.isArray(content)) {
        usageError("--data must be a JSON object");
      }
      const result = await writeLocalCommand({
        agent: "local",
        content,
      });
      if (result.ok) {
        printResult(result, pretty);
      } else {
        printError(result, pretty);
        process.exit(1);
      }
      break;
    }

    case "write-external": {
      const subject = args[1];
      if (!subject) {
        usageError("Usage: cache-ctrl write-external <subject> --data '<json>'");
      }
      const dataStr = typeof flags.data === "string" ? flags.data : undefined;
      if (!dataStr) {
        usageError("Usage: cache-ctrl write-external <subject> --data '<json>'");
      }
      let content: Record<string, unknown>;
      try {
        content = JSON.parse(dataStr) as Record<string, unknown>; // JSON.parse returns any; writeExternalCommand validates the payload shape via Zod before use.
      } catch {
        usageError("--data must be valid JSON");
      }
      if (typeof content !== "object" || content === null || Array.isArray(content)) {
        usageError("--data must be a JSON object");
      }
      const result = await writeExternalCommand({
        agent: "external",
        subject,
        content,
      });
      if (result.ok) {
        printResult(result, pretty);
      } else {
        printError(result, pretty);
        process.exit(1);
      }
      break;
    }

    case "install": {
      const configDir = typeof flags["config-dir"] === "string" ? flags["config-dir"] : undefined;
      const result = await installCommand({ ...(configDir !== undefined ? { configDir } : {}) });
      if (result.ok) {
        printResult(result, pretty);
      } else {
        printError(result, pretty);
        process.exit(1);
      }
      break;
    }

    case "graph": {
      if (flags["max-tokens"] === true) {
        usageError("--max-tokens requires a numeric value");
      }
      const maxTokensRaw = typeof flags["max-tokens"] === "string" ? flags["max-tokens"] : undefined;
      let maxTokensParsed: number | undefined;
      if (maxTokensRaw !== undefined) {
        const parsed = Number(maxTokensRaw);
        if (!Number.isFinite(parsed) || parsed < 0) {
          usageError(`Invalid --max-tokens value: "${maxTokensRaw}". Must be a non-negative number`);
        }
        maxTokensParsed = parsed;
      }
      if (flags.seed === true) {
        usageError("--seed requires a value: --seed <path>[,<path>...]");
      }
      const seedFlagValues = collectFlagValues(rawArgs, "seed");
      const seed = seedFlagValues
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter((value) => value.length > 0);

      const result = await graphCommand({
        ...(maxTokensParsed !== undefined ? { maxTokens: maxTokensParsed } : {}),
        ...(seed.length > 0 ? { seed } : {}),
      });
      if (result.ok) {
        printResult(result, pretty);
      } else {
        printError(result, pretty);
        process.exit(1);
      }
      break;
    }

    case "map": {
      if (flags.depth === true) {
        usageError("--depth requires a value: --depth overview|modules|full");
      }
      const depthRaw = typeof flags.depth === "string" ? flags.depth : undefined;
      if (depthRaw !== undefined && depthRaw !== "overview" && depthRaw !== "modules" && depthRaw !== "full") {
        usageError(`Invalid --depth value: "${depthRaw}". Must be overview, modules, or full`);
      }
      if (flags.folder === true) {
        usageError("--folder requires a value: --folder <path-prefix>");
      }
      const folder = typeof flags.folder === "string" ? flags.folder : undefined;

      const result = await mapCommand({
        ...(depthRaw !== undefined ? { depth: depthRaw } : {}),
        ...(folder !== undefined ? { folder } : {}),
      });

      if (result.ok) {
        printResult(result, pretty);
      } else {
        printError(result, pretty);
        process.exit(1);
      }
      break;
    }

    case "watch": {
      const result = await watchCommand({ verbose: flags.verbose === true });
      if (!result.ok) {
        printError(result, pretty);
        process.exit(1);
      }
      break;
    }

    case "version": {
      const result = versionCommand({});
      if (result.ok) {
        printResult(result, pretty);
      } else {
        printError(result, pretty);
        process.exit(1);
      }
      break;
    }

    default:
      usageError(`Unknown command: "${command}". Commands: list, inspect, flush, invalidate, touch, prune, check-files, search, write-local, write-external, install, graph, map, watch, version`);
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    process.stderr.write(JSON.stringify(toUnknownResult(err)) + "\n");
    process.exit(1);
  });
}

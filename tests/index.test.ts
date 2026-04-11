import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseArgs, usageError, printHelp } from "../src/index.js";
import { __test__ } from "../cache_ctrl.js";

describe("parseArgs", () => {
  it("returns empty args and flags for empty input", () => {
    const result = parseArgs([]);
    expect(result.args).toEqual([]);
    expect(result.flags).toEqual({});
  });

  it("parses positional args", () => {
    const result = parseArgs(["list", "external"]);
    expect(result.args).toEqual(["list", "external"]);
    expect(result.flags).toEqual({});
  });

  it("parses a flag with a value", () => {
    const result = parseArgs(["write-external", "--agent", "external"]);
    expect(result.args).toEqual(["write-external"]);
    expect(result.flags).toEqual({ agent: "external" });
  });

  it("parses a boolean flag (last arg, no value follows)", () => {
    const result = parseArgs(["flush", "all", "--confirm"]);
    expect(result.args).toEqual(["flush", "all"]);
    expect(result.flags).toEqual({ confirm: true });
  });

  it("parses --data value starting with '--'", () => {
    // MED-6: values beginning with '--' must be consumed as flag values, not treated as flags
    const result = parseArgs(["write-local", "--data", "--some-value"]);
    expect(result.args).toEqual(["write-local"]);
    expect(result.flags).toEqual({ data: "--some-value" });
  });

  it("parses multiple flags with values", () => {
    const result = parseArgs(["prune", "--agent", "external", "--max-age", "48h"]);
    expect(result.args).toEqual(["prune"]);
    expect(result.flags).toEqual({ agent: "external", "max-age": "48h" });
  });

  it("parses graph flags with values", () => {
    const result = parseArgs(["graph", "--max-tokens", "512", "--seed", "src/a.ts,src/b.ts"]);
    expect(result.args).toEqual(["graph"]);
    expect(result.flags).toEqual({ "max-tokens": "512", seed: "src/a.ts,src/b.ts" });
  });

  it("parses map depth flag with value", () => {
    const result = parseArgs(["map", "--depth", "full", "--folder", "src/commands"]);
    expect(result.args).toEqual(["map"]);
    expect(result.flags).toEqual({ depth: "full", folder: "src/commands" });
  });

  it("parses a flag with a JSON value containing special characters", () => {
    const json = '{"key":"val"}';
    const result = parseArgs(["write-local", "--data", json]);
    expect(result.args).toEqual(["write-local"]);
    expect(result.flags).toEqual({ data: json });
  });

  it("does not consume next --flag as value for boolean flags", () => {
    const { flags } = parseArgs(["--confirm", "--pretty"]);
    expect(flags.confirm).toBe(true);
    expect(flags.pretty).toBe(true);
  });
});

describe("usageError side effects", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number | string | null) => {
      throw new Error("process.exit called");
    });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("writes JSON error to stderr and exits with code 2", () => {
    expect(() => usageError("test message")).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const written = stderrSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(written) as { ok: boolean; error: string; code: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("test message");
    expect(parsed.code).toBe("INVALID_ARGS");
  });
});

describe("printHelp", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  function capturedOutput(): string {
    return (stdoutSpy.mock.calls as [string | Uint8Array][])
      .map((call) => String(call[0]))
      .join("");
  }

  it("full help contains 'cache-ctrl' and 'Usage'", () => {
    const result = printHelp();
    const output = capturedOutput();
    expect(result).toBe(true);
    expect(output).toContain("cache-ctrl");
    expect(output).toContain("Usage");
  });

  it("full help contains all command names", () => {
    printHelp();
    const output = capturedOutput();
    const commands = [
      "list",
      "inspect",
      "flush",
      "invalidate",
      "touch",
      "prune",
      "check-freshness",
      "check-files",
      "search",
      "write-local",
      "write-external",
      "install",
      "graph",
      "map",
      "watch",
      "version",
    ];
    for (const cmd of commands) {
      expect(output).toContain(cmd);
    }
  });

  it("list command help contains 'list' and '--agent'", () => {
    const result = printHelp("list");
    const output = capturedOutput();
    expect(result).toBe(true);
    expect(output).toContain("list");
    expect(output).toContain("--agent");
  });

  it("inspect command help contains 'inspect' and 'subject-keyword'", () => {
    const result = printHelp("inspect");
    const output = capturedOutput();
    expect(result).toBe(true);
    expect(output).toContain("inspect");
    expect(output).toContain("subject-keyword");
  });

  it("unknown command writes to stderr (not stdout) and returns false", () => {
    const result = printHelp("unknown-cmd");
    const stdout = capturedOutput();
    const stderr = (stderrSpy.mock.calls as [string | Uint8Array][])
      .map((call) => String(call[0]))
      .join("");
    expect(result).toBe(false);
    expect(stdout).toBe("");
    expect(stderr).toContain("Unknown command");
  });

  it("'help' command returns true and output contains 'Usage' (full help)", () => {
    const result = printHelp("help");
    const output = capturedOutput();
    expect(result).toBe(true);
    expect(output).toContain("Usage");
  });

  it.each(["list", "inspect", "flush", "invalidate", "touch", "prune", "check-freshness", "check-files", "search", "write-local", "write-external", "install", "graph", "map", "watch", "version"])(
    "per-command help for '%s' writes to stdout",
    (cmd) => {
      const ok = printHelp(cmd);
      const output = capturedOutput();
      expect(ok).toBe(true);
      expect(output).toContain(cmd);
    },
  );
});

describe("cache_ctrl helper guards", () => {
  describe("isRefinementContext", () => {
    it("returns true for object with addIssue function", () => {
      const context = { addIssue: vi.fn() };
      expect(__test__.isRefinementContext(context)).toBe(true);
    });

    it("returns false for boundary non-object values", () => {
      expect(__test__.isRefinementContext(null)).toBe(false);
      expect(__test__.isRefinementContext(undefined)).toBe(false);
      expect(__test__.isRefinementContext("ctx")).toBe(false);
      expect(__test__.isRefinementContext(42)).toBe(false);
      expect(__test__.isRefinementContext({})).toBe(false);
      expect(__test__.isRefinementContext({ addIssue: "not-a-function" })).toBe(false);
    });
  });

  describe("rejectTraversalKeys", () => {
    it("does not add issues for valid keys", () => {
      const addIssue = vi.fn();
      __test__.rejectTraversalKeys(
        {
          "src/index.ts": { summary: "ok" },
          "docs/readme.md": { summary: "ok" },
        },
        { addIssue },
      );
      expect(addIssue).not.toHaveBeenCalled();
    });

    it("adds issues for traversal and invalid-character keys", () => {
      const addIssue = vi.fn();
      __test__.rejectTraversalKeys(
        {
          "../secret": {},
          "/etc/passwd": {},
          "safe\x00evil": {},
        },
        { addIssue },
      );

      expect(addIssue).toHaveBeenCalledTimes(3);
      expect(addIssue).toHaveBeenNthCalledWith(1, {
        code: "custom",
        message: 'facts key contains a path traversal or invalid character: "../secret"',
        path: ["../secret"],
      });
      expect(addIssue).toHaveBeenNthCalledWith(2, {
        code: "custom",
        message: 'facts key contains a path traversal or invalid character: "/etc/passwd"',
        path: ["/etc/passwd"],
      });
      expect(addIssue).toHaveBeenNthCalledWith(3, {
        code: "custom",
        message: 'facts key contains a path traversal or invalid character: "safe\u0000evil"',
        path: ["safe\x00evil"],
      });
    });

    it("is a no-op when refinement context is invalid", () => {
      const badContext = { addIssue: "nope" };
      expect(() => __test__.rejectTraversalKeys({ "../secret": {} }, badContext)).not.toThrow();
    });
  });
});

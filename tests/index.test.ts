import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseArgs, usageError, printHelp } from "../src/index.js";

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
    const result = parseArgs(["write", "--agent", "external"]);
    expect(result.args).toEqual(["write"]);
    expect(result.flags).toEqual({ agent: "external" });
  });

  it("parses a boolean flag (last arg, no value follows)", () => {
    const result = parseArgs(["flush", "all", "--confirm"]);
    expect(result.args).toEqual(["flush", "all"]);
    expect(result.flags).toEqual({ confirm: true });
  });

  it("parses --data value starting with '--'", () => {
    // MED-6: values beginning with '--' must be consumed as flag values, not treated as flags
    const result = parseArgs(["write", "--data", "--some-value"]);
    expect(result.args).toEqual(["write"]);
    expect(result.flags).toEqual({ data: "--some-value" });
  });

  it("parses multiple flags with values", () => {
    const result = parseArgs(["prune", "--agent", "external", "--max-age", "48h"]);
    expect(result.args).toEqual(["prune"]);
    expect(result.flags).toEqual({ agent: "external", "max-age": "48h" });
  });

  it("parses a flag with a JSON value containing special characters", () => {
    const json = '{"key":"val"}';
    const result = parseArgs(["write", "--data", json]);
    expect(result.args).toEqual(["write"]);
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

  it("full help contains all 10 command names", () => {
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
      "write",
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

  it.each(["list", "inspect", "flush", "invalidate", "touch", "prune", "check-freshness", "check-files", "search", "write"])(
    "per-command help for '%s' writes to stdout",
    (cmd) => {
      const ok = printHelp(cmd);
      const output = capturedOutput();
      expect(ok).toBe(true);
      expect(output).toContain(cmd);
    },
  );
});

/**
 * Result of a CLI subprocess invocation.
 * stdout and stderr are the complete raw text output.
 * exitCode mirrors the process exit code (0, 1, or 2).
 */
export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const CLI_ENTRYPOINT = "/app/src/index.ts";

/**
 * Spawns: bun /app/src/index.ts ...args
 *
 * @param args    - CLI arguments (e.g. ["list", "--agent", "external"])
 * @param options.cwd - Working directory for the subprocess. Defaults to process.cwd().
 *
 * The function always resolves (never rejects) — a non-zero exit code is NOT an exception.
 * Callers must check result.exitCode themselves.
 */
export async function runCli(
  args: string[],
  options?: { cwd?: string },
): Promise<CliResult> {
  const proc = Bun.spawn(["bun", CLI_ENTRYPOINT, ...args], {
    cwd: options?.cwd ?? process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

/**
 * Parses the stdout of a CLI invocation as JSON.
 *
 * @param raw - Raw stdout string from runCli()
 * @returns Parsed JSON value cast to T
 * @throws Error if raw is empty or not valid JSON
 *
 * Usage: const parsed = parseJsonOutput<{ ok: boolean }>(result.stdout);
 *
 * The cast is safe here because callers supply T based on the known CLI contract.
 * Callers are responsible for narrowing ok before accessing value.
 */
export function parseJsonOutput<T = unknown>(raw: string): T {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("parseJsonOutput: stdout was empty");
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`parseJsonOutput: invalid JSON from CLI — ${message}\n${trimmed.slice(0, 200)}`);
  }
}

/**
 * Spawns: bun /app/src/index.ts ...args
 *
 * Kills the process after `timeoutMs` if it has not already exited.
 * exitCode is -1 when the process was killed by the timeout.
 *
 * Useful for testing daemon commands (e.g. `watch`) that never exit on their own.
 *
 * @param args - CLI arguments to pass after the entrypoint.
 * @param timeoutMs - Milliseconds to wait before killing the process.
 * @param options - Optional spawn options (e.g. `cwd`).
 */
export async function runCliWithTimeout(
  args: string[],
  timeoutMs: number,
  options?: { cwd?: string },
): Promise<CliResult> {
  const proc = Bun.spawn(["bun", CLI_ENTRYPOINT, ...args], {
    cwd: options?.cwd ?? process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  let stdout = "";
  let stderr = "";
  let rawExitCode = 1;
  try {
    [stdout, stderr, rawExitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
  } finally {
    clearTimeout(timer);
  }

  return { stdout, stderr, exitCode: timedOut ? -1 : rawExitCode };
}

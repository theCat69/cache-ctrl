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
  const proc = Bun.spawn(["bun", "/app/src/index.ts", ...args], {
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
  return JSON.parse(trimmed) as T;
}

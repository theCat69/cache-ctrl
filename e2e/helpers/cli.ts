import { spawn } from "node:child_process";

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

interface CliExecutionOptions {
  cwd?: string;
  timeoutMs?: number;
}

const CLI_ENTRYPOINT = "/app/bin/cache-ctrl.js";

function readStream(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (stream === null) {
    return Promise.resolve("");
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    stream.on("data", (chunk: string | Buffer) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    stream.on("error", reject);
  });
}

/**
 * Spawns the published Bun CLI wrapper with ...args.
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
  return executeCli(args, options?.cwd === undefined ? {} : { cwd: options.cwd });
}

async function executeCli(args: string[], options: CliExecutionOptions): Promise<CliResult> {
  const proc = spawn(CLI_ENTRYPOINT, args, {
    cwd: options?.cwd ?? process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (options.timeoutMs !== undefined) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, options.timeoutMs);
  }

  const exitCodePromise = new Promise<number>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (exitCode) => {
      resolve(exitCode ?? 1);
    });
  });

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readStream(proc.stdout),
      readStream(proc.stderr),
      exitCodePromise,
    ]);

    return { stdout, stderr, exitCode: timedOut ? -1 : exitCode };
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
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
 * Spawns the published Bun CLI wrapper with ...args.
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
  if (options?.cwd === undefined) {
    return executeCli(args, { timeoutMs });
  }

  return executeCli(args, {
    cwd: options.cwd,
    timeoutMs,
  });
}

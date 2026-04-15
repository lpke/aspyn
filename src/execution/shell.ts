import { spawn } from "node:child_process";

// ── Types ───────────────────────────────────────────────────────────

export interface ShellOptions {
  command: string;
  cwd: string;
  stdin?: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ── Constants ───────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_S = 30;
const SIGKILL_GRACE_MS = 2_000;
const TIMEOUT_EXIT_CODE = 124;

// ── Shell executor ──────────────────────────────────────────────────

export function execShell(options: ShellOptions): Promise<ShellResult> {
  const {
    command,
    cwd,
    stdin,
    timeout = DEFAULT_TIMEOUT_S,
    env,
  } = options;

  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", command], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Pipe stdin if provided, then close the stream.
    if (stdin !== undefined) {
      child.stdin.write(stdin, () => {
        child.stdin.end();
      });
    } else {
      child.stdin.end();
    }

    // Timeout handling: SIGTERM → wait 2 s → SIGKILL.
    timeoutTimer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");

      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Process already exited — ignore.
        }
      }, SIGKILL_GRACE_MS);
    }, timeout * 1_000);

    child.on("close", (code) => {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);

      resolve({
        stdout,
        stderr,
        exitCode: killed ? TIMEOUT_EXIT_CODE : (code ?? 1),
      });
    });
  });
}

// ── JSON output parser ──────────────────────────────────────────────

export function parseJsonOutput(stdout: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(stdout.trim());
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

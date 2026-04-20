import { spawn } from 'node:child_process';
import {
  DEFAULT_TIMEOUT_SECONDS,
  SHELL_SIGKILL_GRACE_MS,
  SHELL_TIMEOUT_EXIT_CODE,
} from '../constants.js';

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

// ── Shell executor ──────────────────────────────────────────────────

export function execShell(options: ShellOptions): Promise<ShellResult> {
  const {
    command,
    cwd,
    stdin,
    timeout = DEFAULT_TIMEOUT_SECONDS,
    env,
  } = options;

  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
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
      child.kill('SIGTERM');

      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Process already exited — ignore.
        }
      }, SHELL_SIGKILL_GRACE_MS);
    }, timeout * 1_000);

    child.on('close', (code) => {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);

      resolve({
        stdout,
        stderr,
        exitCode: killed ? SHELL_TIMEOUT_EXIT_CODE : (code ?? 1),
      });
    });
  });
}

// ── JSON output parser ──────────────────────────────────────────────

export function parseJsonOutput(
  stdout: string,
): unknown {
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
}

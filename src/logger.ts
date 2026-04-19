import fs from "node:fs/promises";
import fss from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { DEFAULT_ROTATION_MAX_FILE_SIZE, DEFAULT_ROTATION_MAX_FILES } from "./constants.js";

// ── Types ───────────────────────────────────────────────────────────

import type { LogLevel } from "./types/config.js";

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
  logFile?: string;
  maxFileSize?: string;
  maxFiles?: number;
}

// ── Level hierarchy ─────────────────────────────────────────────────

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ── Size parser ─────────────────────────────────────────────────────

export function parseSize(input: string): number {
  const match = input.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(kb|mb|gb|b?)$/);
  if (!match) throw new Error(`Invalid size format: "${input}"`);
  const value = parseFloat(match[1]);
  const unit = match[2];
  switch (unit) {
    case "kb": return Math.floor(value * 1024);
    case "mb": return Math.floor(value * 1024 * 1024);
    case "gb": return Math.floor(value * 1024 * 1024 * 1024);
    default: return Math.floor(value);
  }
}

// ── Log rotation ────────────────────────────────────────────────────

export async function rotateIfNeeded(
  filePath: string,
  maxFileSize: string,
  maxFiles: number,
): Promise<void> {
  const maxBytes = parseSize(maxFileSize);

  let stat: fss.Stats;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return; // file doesn't exist yet
  }

  if (stat.size < maxBytes) return;

  // Rotate: delete oldest, shift others up
  for (let i = maxFiles; i >= 1; i--) {
    const src = i === 1 ? filePath : `${filePath}.${i - 1}`;
    const dst = `${filePath}.${i}`;
    if (i === maxFiles) {
      try { await fs.unlink(dst); } catch { /* ok */ }
    }
    try { await fs.rename(src, dst); } catch { /* ok */ }
  }
}

// ── Timestamp ───────────────────────────────────────────────────────

function isoTimestamp(): string {
  return new Date().toISOString();
}

function timestamp(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// ── Synchronous rotation ────────────────────────────────────────────

export function rotateIfNeededSync(
  filePath: string,
  maxFileSize: string,
  maxFiles: number,
): void {
  const maxBytes = parseSize(maxFileSize);
  let stat: fss.Stats;
  try {
    stat = fss.statSync(filePath);
  } catch {
    return;
  }
  if (stat.size < maxBytes) return;
  for (let i = maxFiles; i >= 1; i--) {
    const src = i === 1 ? filePath : `${filePath}.${i - 1}`;
    const dst = `${filePath}.${i}`;
    if (i === maxFiles) {
      try { fss.unlinkSync(dst); } catch { /* ok */ }
    }
    try { fss.renameSync(src, dst); } catch { /* ok */ }
  }
}

// ── Format for file (no ANSI) ───────────────────────────────────────

function formatFileLine(ts: string, level: LogLevel, prefix: string | undefined, args: unknown[]): string {
  const parts: string[] = [ts];
  if (level !== "info") parts.push(`[${level.toUpperCase()}]`);
  if (prefix) parts.push(`[${prefix}]`);
  parts.push(args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" "));
  return parts.join(" ") + "\n";
}

// ── createLogger ────────────────────────────────────────────────────

export function createLogger(options?: LoggerOptions): Logger {
  const minLevel = LEVELS[options?.level ?? "info"];
  const prefix = options?.prefix;
  const logFile = options?.logFile;
  const maxFileSize = options?.maxFileSize ?? DEFAULT_ROTATION_MAX_FILE_SIZE;
  const maxFiles = options?.maxFiles ?? DEFAULT_ROTATION_MAX_FILES;

  function log(level: LogLevel, args: unknown[]): void {
    if (LEVELS[level] < minLevel) return;

    const ts = timestamp();

    // Build stderr line
    const parts: string[] = [chalk.dim(ts)];
    if (level === "debug") parts.push(chalk.dim("[DEBUG]"));
    else if (level === "warn") parts.push(chalk.yellow("[WARN]"));
    else if (level === "error") parts.push(chalk.red("[ERROR]"));
    if (prefix) parts.push(chalk.cyan(`[${prefix}]`));
    parts.push(args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" "));

    process.stderr.write(parts.join(" ") + "\n");

    // File mirror (synchronous to avoid lost writes on process exit)
    if (logFile) {
      const line = formatFileLine(isoTimestamp(), level, prefix, args);
      const dir = path.dirname(logFile);
      try {
        fss.mkdirSync(dir, { recursive: true });
        rotateIfNeededSync(logFile, maxFileSize, maxFiles);
        fss.appendFileSync(logFile, line, "utf-8");
      } catch { /* best effort */ }
    }
  }

  return {
    debug: (...args: unknown[]) => log("debug", args),
    info: (...args: unknown[]) => log("info", args),
    warn: (...args: unknown[]) => log("warn", args),
    error: (...args: unknown[]) => log("error", args),
  };
}

// ── Global singleton ────────────────────────────────────────────────

// Reads level from global config lazily. For now, default to "info".
// The daemon/CLI can re-initialize if needed after loading global config.
let current: Logger = createLogger();

export const logger: Logger = {
  debug: (...a) => current.debug(...a),
  info:  (...a) => current.info(...a),
  warn:  (...a) => current.warn(...a),
  error: (...a) => current.error(...a),
};

export function initGlobalLogger(options: LoggerOptions): void {
  current = createLogger(options);
}

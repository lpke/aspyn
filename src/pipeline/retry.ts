import type { RetryConfig } from "../types/config.js";
import { intervalToMs } from "../scheduling/interval.js";

// ── Helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(
  attempt: number,
  baseMs: number,
  strategy: RetryConfig["backoff"],
): number {
  switch (strategy) {
    case "fixed":
      return baseMs;
    case "linear":
      return baseMs * attempt;
    case "exponential":
      return baseMs * 2 ** (attempt - 1);
  }
}

// ── withRetry ───────────────────────────────────────────────────────

export async function withRetry<T>(
  fn: () => Promise<T>,
  retryConfig: RetryConfig | undefined,
): Promise<T> {
  if (!retryConfig) return fn();

  const baseMs = intervalToMs(retryConfig.initialDelay);
  let lastError: unknown;

  for (let attempt = 1; attempt <= retryConfig.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retryConfig.attempts) {
        await sleep(backoffMs(attempt, baseMs, retryConfig.backoff));
      }
    }
  }

  throw lastError;
}

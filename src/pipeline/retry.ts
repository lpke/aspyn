import type { RetryConfig } from "../types/config.js";
import type { Logger } from "../logger.js";
import { logger as globalLogger } from "../logger.js";
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
  log?: Logger,
): Promise<T> {
  if (!retryConfig) return fn();

  const logger = log ?? globalLogger;

  const baseMs = intervalToMs(retryConfig.initialDelay);
  let lastError: unknown;

  for (let attempt = 1; attempt <= retryConfig.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retryConfig.attempts) {
        const delay = backoffMs(attempt, baseMs, retryConfig.backoff);
        logger.debug(`Retry ${attempt}/${retryConfig.attempts} in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

// ── Duration parsing ────────────────────────────────────────────────

import cron from 'node-cron';

const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/;

const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse a duration value into milliseconds.
 * - Number input is interpreted as **seconds** (backwards-compat convention).
 * - String input must match `<value><unit>` where unit ∈ {ms, s, m, h, d}.
 */
export function parseDurationMs(input: string | number): number {
  if (typeof input === 'number') {
    return input * 1_000;
  }
  const m = DURATION_RE.exec(input);
  if (!m) {
    throw new Error(
      `Invalid duration string: "${input}". Expected format: <number><ms|s|m|h|d>`,
    );
  }
  return parseFloat(m[1]) * UNIT_MS[m[2]];
}

/**
 * Convert duration input to ms. Number = seconds (convention used across all config).
 */
export function toMs(input: string | number): number {
  if (typeof input === 'number') return input * 1_000;
  return parseDurationMs(input);
}

/**
 * Valid interval = duration shorthand OR cron expression.
 */
export function isValidInterval(input: string): boolean {
  return DURATION_RE.test(input) || cron.validate(input);
}


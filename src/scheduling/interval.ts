import type { Logger } from "../logger.js";
import { logger as globalLogger } from "../logger.js";


// ── Interval parsing & scheduling utilities ─────────────────────────

const SHORTHAND_RE = /^(\d+)(s|m|h|d)$/;

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

// ── parseInterval ───────────────────────────────────────────────────

export type ParsedInterval =
  | { type: "cron"; expression: string }
  | { type: "ms"; milliseconds: number };

export function parseInterval(input: string): ParsedInterval {
  const match = input.match(SHORTHAND_RE);
  if (match) {
    const value = Number(match[1]);
    const unit = match[2] as keyof typeof UNIT_MS;
    return { type: "ms", milliseconds: value * UNIT_MS[unit] };
  }

  const fields = input.trim().split(/\s+/);
  if (fields.length === 5 || fields.length === 6) {
    return { type: "cron", expression: input };
  }

  throw new Error(`Unrecognised interval format: "${input}"`);
}

// ── intervalToMs ────────────────────────────────────────────────────

export function intervalToMs(input: string): number {
  const parsed = parseInterval(input);
  if (parsed.type === "ms") return parsed.milliseconds;

  // Rough cron → ms estimate: find the smallest step implied by each field.
  return estimateCronMs(parsed.expression);
}

/**
 * Very rough estimate of the minimum gap (in ms) between two cron runs.
 * Only used for min-interval clamping — precision is not critical.
 */
function estimateCronMs(expression: string): number {
  const fields = expression.trim().split(/\s+/);

  // 6-field cron: [seconds, minutes, hours, dom, month, dow]
  // 5-field cron: [minutes, hours, dom, month, dow]
  const hasSec = fields.length === 6;
  const secField = hasSec ? fields[0] : undefined;
  const minField = hasSec ? fields[1] : fields[0];
  const hourField = hasSec ? fields[2] : fields[1];
  const domField = hasSec ? fields[3] : fields[2];

  // Try to derive interval from the most granular field that has a step.
  if (secField) {
    const secStep = extractStep(secField, 60);
    if (secStep !== null) return secStep * 1_000;
  }

  const minStep = extractStep(minField, 60);
  if (minStep !== null) return minStep * 60_000;

  const hourStep = extractStep(hourField, 24);
  if (hourStep !== null) return hourStep * 3_600_000;

  const domStep = extractStep(domField, 31);
  if (domStep !== null) return domStep * 86_400_000;

  // Fallback: assume once per day.
  return 86_400_000;
}

/**
 * Extract the effective step from a single cron field.
 * Handles `*\/N`, `N` (specific value → null), and `*` (every 1).
 */
function extractStep(field: string, _range: number): number | null {
  if (field.includes("/")) {
    const step = Number(field.split("/")[1]);
    return Number.isFinite(step) && step > 0 ? step : null;
  }
  if (field === "*") return 1;
  // Specific value or list — can't infer a step.
  return null;
}

// ── clampInterval ───────────────────────────────────────────────────

export function clampInterval(input: string, minInterval: string, log?: Logger): string {
  const logger = log ?? globalLogger;
  const inputMs = intervalToMs(input);
  const minMs = intervalToMs(minInterval);

  if (inputMs < minMs) {
    logger.warn(
      `Interval "${input}" (~${inputMs}ms) is below minimum "${minInterval}" (~${minMs}ms) — clamping.`,
    );
    return minInterval;
  }

  return input;
}

// ── shorthandToCron ─────────────────────────────────────────────────

export function shorthandToCron(input: string): string {
  const match = input.match(SHORTHAND_RE);
  if (!match) {
    // Already a cron expression (or will fail at scheduling time).
    return input;
  }

  const value = Number(match[1]);
  const unit = match[2];

  switch (unit) {
    case "s":
      // 6-field cron with seconds
      return `*/${value} * * * * *`;
    case "m":
      return `*/${value} * * * *`;
    case "h":
      return `0 */${value} * * *`;
    case "d":
      return `0 0 */${value} * *`;
    default:
      return input;
  }
}

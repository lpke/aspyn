import {
  LOG_LEVELS,
  MISSED_RUN_POLICIES,
  HANDLER_TYPES,
  CANONICAL_STEP_NAMES,
} from "../constants.js";

export type LogLevel = (typeof LOG_LEVELS)[number];
export type MissedRunPolicy = (typeof MISSED_RUN_POLICIES)[number];
export type HandlerType = (typeof HANDLER_TYPES)[number];
export type CanonicalStepName = (typeof CANONICAL_STEP_NAMES)[number];

// ── Retry spec ──────────────────────────────────────────────────────

export interface RetrySpec {
  attempts: number;
  backoff: "fixed" | "linear" | "exponential";
  initialDelay: number;
}

// ── State history config ────────────────────────────────────────────

export interface StateHistoryConfig {
  enabled?: boolean;
  maxFileSize?: string;
  maxFiles?: number;
}

// ── Step ────────────────────────────────────────────────────────────

export interface StepObject {
  name: string;
  type: string;
  description?: string;
  input?: unknown;
  sideEffect?: boolean;
  track?: boolean;
  continueOnError?: boolean;
  when?: string;
  timeout?: string | number;
  retry?: RetrySpec;
  onError?: Step;
}

export type Step = string | StepObject;

// ── Pipeline config (per-pipeline config.jsonc) ─────────────────────

export interface PipelineConfig {
  name?: string;
  description?: string;
  interval?: string;
  timeout?: string | number;
  retry?: RetrySpec;
  proceedOnError?: boolean;
  onError?: Step;
  log?: LogLevel;
  stateHistory?: StateHistoryConfig;
  pipeline: Step[];
}

// ── Global config (~/.config/aspyn/config.jsonc) ────────────────────

export interface GlobalConfig {
  defaultInterval: string;
  defaultTimeout: number;
  minInterval: string;
  shutdownTimeout: number;
  missedRunPolicy: MissedRunPolicy;
  playwright?: {
    browser?: "chromium" | "firefox" | "webkit";
    headless?: boolean;
  };
  log: LogLevel;
  stateHistory: StateHistoryConfig;
}

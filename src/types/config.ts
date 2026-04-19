// ── Log level ───────────────────────────────────────────────────────

export type LogLevel = "error" | "warn" | "info" | "debug";

// ── Missed-run policy ───────────────────────────────────────────────

export type MissedRunPolicy = "run_once" | "skip" | "run_all";

// ── Retry spec ──────────────────────────────────────────────────────

export interface RetrySpec {
  attempts: number;
  backoff: "fixed" | "linear" | "exponential";
  initialDelay: number;
}

// ── State history config ────────────────────────────────────────────

export interface StateHistoryConfig {
  enabled?: boolean;
  maxFileSize?: number;
  maxFiles?: number;
}

// ── Step ────────────────────────────────────────────────────────────

export interface StepObject {
  name: string;
  type: string;
  description?: string;
  input?: Record<string, unknown>;
  sideEffect?: boolean;
  track?: boolean;
  continueOnError?: boolean;
  when?: string;
  timeout?: number;
  retry?: RetrySpec;
  onError?: string;
}

export type Step = string | StepObject;

// ── Pipeline config (per-pipeline config.jsonc) ─────────────────────

export interface PipelineConfig {
  name?: string;
  description?: string;
  interval?: number;
  timeout?: number;
  retry?: RetrySpec;
  proceedOnError?: boolean;
  onError?: string;
  log?: LogLevel;
  stateHistory?: StateHistoryConfig;
  pipeline: Step[];
}

// ── Global config (~/.config/aspyn/config.jsonc) ────────────────────

export interface GlobalConfig {
  defaultInterval: number;
  defaultTimeout: number;
  minInterval: number;
  shutdownTimeout: number;
  missedRunPolicy: MissedRunPolicy;
  playwright?: {
    browser?: "chromium" | "firefox" | "webkit";
    headless?: boolean;
  };
  log: LogLevel;
  stateHistory: StateHistoryConfig;
}

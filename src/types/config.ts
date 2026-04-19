import type { LogLevel, MissedRunPolicy } from "../constants.js";

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
  timeout?: number;
  retry?: RetrySpec;
  onError?: string;
}

export type Step = string | StepObject;

// ── Pipeline config (per-pipeline config.jsonc) ─────────────────────

export interface PipelineConfig {
  name?: string;
  description?: string;
  interval?: string;
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

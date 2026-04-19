import type { StepObject } from "./config.js";
import {
  RUN_STATUSES,
  HALT_REASONS,
} from "../constants.js";

// ── Derived enum types ──────────────────────────────────────────────

export type RunStatus = (typeof RUN_STATUSES)[number];
export type HaltReason = (typeof HALT_REASONS)[number];

// ── Step output ───────────────────────────────────────────────────────

export type StepOutput = unknown;

// ── Pipeline context (passed to handlers) ─────────────────────────

export interface PipelineContext {
  input: Record<string, unknown>;
  steps: Record<string, StepOutput>;
  prev: Record<string, StepOutput>;
  changed: Record<string, boolean>;
  firstRun: boolean;
  meta: {
    pipeline: string;
    timestamp: string;
    interval: string | null;
    run_number: number;
  };
}

// ── Soft error ──────────────────────────────────────────────────────

export interface SoftError {
  step: string;
  message: string;
  handled: "proceedOnError" | "continueOnError";
}

// ── Halt ────────────────────────────────────────────────────────────

export interface Halt {
  atStep: string;
  reason: HaltReason;
}

// ── Step status ─────────────────────────────────────────────────────


// ── Run options ─────────────────────────────────────────────────────

export type RunOptions = {
  from?: string | number;
  until?: string | number;
  dry?: boolean;
  replaySideEffects?: boolean;
  continueFromCrash?: boolean;
  resetCrash?: boolean;
  verbose?: boolean;
};

// ── Run result ──────────────────────────────────────────────────────

export type RunResult = {
  status: RunStatus;
  runId: string;
  halt?: Halt;
  error?: { message: string; step: string };
};

// ── Once result (inner pipeline execution) ──────────────────────────

export type OnceResult = {
  status: RunStatus;
  halt?: Halt;
  error?: { message: string; step: string };
  pipelineTimedOut?: boolean;
  softErrors: SoftError[];
  warnings: Array<{ step: string; message: string }>;
  stepOutputs: Record<string, StepOutput>;
  changedMap: Record<string, boolean>;
  lastValues: Record<string, StepOutput>;
};

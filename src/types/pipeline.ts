import type { RunStatus, HaltReason } from "../constants.js";

export type { RunStatus };

// ── Step output ─────────────────────────────────────────────────────

export type StepOutput = unknown;

// ── Pipeline context (passed to handlers) ───────────────────────────

export interface PipelineContext {
  input: Record<string, unknown>;
  steps: Record<string, StepOutput>;
  prev: Record<string, StepOutput> | null;
  __changedMap: Record<string, boolean>;
  firstRun: boolean;
  meta: {
    pipeline: string;
    timestamp: string;
    interval: string;
    run_number: number;
  };
}

// ── Soft error ──────────────────────────────────────────────────────

export interface SoftError {
  step: string;
  message: string;
  handled: "proceedOnError" | "continueOnError";
}

// ── Handler result ──────────────────────────────────────────────────

export interface HandlerResult {
  output: StepOutput;
}

// ── Halt ────────────────────────────────────────────────────────────

export interface Halt {
  atStep: string;
  reason: HaltReason;
}

// ── Step status ─────────────────────────────────────────────────────

export type StepStatus = "ok" | "error" | "skipped" | "halted";

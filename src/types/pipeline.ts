import type { StepObject } from './config.js';
import { RUN_STATUSES, HALT_REASONS } from '../constants.js';

// ── Derived enum types ──────────────────────────────────────────────

export type RunStatus = (typeof RUN_STATUSES)[number];
export type HaltReason = (typeof HALT_REASONS)[number];

// ── Step output ───────────────────────────────────────────────────────

export type StepOutput = unknown;

// ── Pipeline context (passed to handlers) ─────────────────────────

export interface PipelineContext {
  /** Previous step's output, or the pipeline trigger payload on the first step. */
  input: unknown;
  steps: Record<string, StepOutput>;
  prev: Record<string, StepOutput>;
  changed: Record<string, boolean>;
  firstRun: boolean;
  signal: AbortSignal;
  stepTimeoutMs: number;
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
  handled: 'proceedOnError' | 'continueOnError';
}

// ── Halt ────────────────────────────────────────────────────────────

export interface Halt {
  atStep: string;
  reason: HaltReason;
}

// ── Handler halt signal ─────────────────────────────────────────────

export const ASPYN_HALT_SYMBOL: unique symbol = Symbol.for('aspyn.halt');
export interface HandlerHaltSignal {
  [ASPYN_HALT_SYMBOL]: true;
  reason: 'handler_throw' | 'aspyn_level';
  message: string;
}
export function isHandlerHalt(v: unknown): v is HandlerHaltSignal {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as Record<PropertyKey, unknown>)[ASPYN_HALT_SYMBOL] === true
  );
}

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
  /** ULID for this run. Empty string when status === "interrupted". */
  runId: string;
  halt?: Halt;
  error?: { message: string; step: string | null; kind?: 'pipeline_timeout' };
};

// ── Once result (inner pipeline execution) ──────────────────────────

export type OnceResult = {
  status: RunStatus;
  halt?: Halt;
  error?: { message: string; step: string | null; kind?: 'pipeline_timeout' };
  pipelineTimedOut?: boolean;
  softErrors: SoftError[];
  warnings: Array<{ step: string; message: string }>;
  stepOutputs: Record<string, StepOutput>;
  changedMap: Record<string, boolean>;
  lastValues: Record<string, StepOutput>;
};

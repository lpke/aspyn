// ── Step output ─────────────────────────────────────────────────────

export type StepOutput = unknown;

// ── Pipeline context (passed to handlers) ───────────────────────────

export interface PipelineContext {
  input: Record<string, unknown>;
  steps: Record<string, StepOutput>;
  prev: Record<string, StepOutput> | null;
  changed: boolean;
  firstRun: boolean;
  meta: {
    pipeline: string;
    timestamp: string;
    interval: number;
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
  reason:
    | "gate_falsy"
    | "expr_throw"
    | "timeout"
    | "handler_throw"
    | string;
}

// ── Step status ─────────────────────────────────────────────────────

export type StepStatus = "ok" | "error" | "skipped" | "halted";

// ── Run status ──────────────────────────────────────────────────────

export type RunStatus = "ok" | "error" | "halted" | "interrupted" | "skipped";

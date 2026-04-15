// ── Step output ─────────────────────────────────────────────────────

export type StepOutput = Record<string, unknown>;

// ── Pipeline context (passed to check & action steps) ───────────────

export interface PipelineContext {
  value: StepOutput;
  prev: StepOutput | null;
  changed: boolean;
  firstRun: boolean;
  meta: {
    watch: string;
    timestamp: string;
    interval: string;
  };
}

// ── Pipeline result (outcome of a full pipeline run) ────────────────

export interface PipelineResult {
  success: boolean;
  value: StepOutput | null;
  error: string | null;
  skipped: boolean;
}

import type { StepOutput, RunStatus, Halt, SoftError, StepStatus } from "./pipeline.js";

// ── Persisted pipeline state ────────────────────────────────────────

export interface PipelineState {
  lastRun: string | null;
  lastStatus: RunStatus | null;
  lastError: string | null;
  runCount: number;
  consecutiveFailures: number;
  lastValues: Record<string, StepOutput>;
}

// ── State history entry (JSONL) ─────────────────────────────────────

export interface StateHistoryEntry {
  runId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  runNumber: number;
  status: RunStatus;
  halt: Halt | null;
  error: string | null;
  stepOutputs: Record<string, StepOutput>;
  warnings: string[];
  softErrors: SoftError[];
}

// ── Journal events (run.lock.jsonl) ─────────────────────────────────

export interface JournalRunStart {
  event: "run_start";
  runId: string;
  pid: number;
  startedAt: string;
}

export interface JournalStepStart {
  event: "step_start";
  runId: string;
  step: string;
  startedAt: string;
}

export interface JournalStepOutput {
  event: "step_output";
  runId: string;
  step: string;
  output: StepOutput;
}

export interface JournalStepEnd {
  event: "step_end";
  runId: string;
  step: string;
  status: StepStatus;
  endedAt: string;
}

export interface JournalContextFile {
  event: "context_file";
  runId: string;
  path: string;
}

export interface JournalRunEnd {
  event: "run_end";
  runId: string;
  status: RunStatus;
  endedAt: string;
}

export type JournalEvent =
  | JournalRunStart
  | JournalStepStart
  | JournalStepOutput
  | JournalStepEnd
  | JournalContextFile
  | JournalRunEnd;

import type { StepOutput, RunStatus, Halt, SoftError } from './pipeline.js';
import { JOURNAL_EVENTS } from '../constants.js';

export type JournalEventType = (typeof JOURNAL_EVENTS)[number];

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
  warnings: Array<{ step: string; message: string }>;
  softErrors: SoftError[];
}

// ── Journal events (run.lock.jsonl) ─────────────────────────────────

export interface JournalRunStart {
  type: 'run_start';
  runId: string;
  pid: number;
  startedAt: string;
}

export interface JournalStepStart {
  type: 'step_start';
  runId: string;
  name: string;
  startedAt: string;
}

export interface JournalStepOutput {
  type: 'step_output';
  runId: string;
  name: string;
  output: StepOutput;
}

export interface JournalStepEnd {
  type: 'step_end';
  runId: string;
  name: string;
  status: RunStatus;
  endedAt: string;
}

export interface JournalContextFile {
  type: 'context_file';
  runId: string;
  path: string;
}

export interface JournalRunEnd {
  type: 'run_end';
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

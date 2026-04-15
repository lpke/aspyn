import type { StepOutput } from "./pipeline.js";

// ── Persisted watch state (~/.local/share/aspyn/state/<name>/state.json) ──

export interface WatchState {
  lastRun: string | null;
  lastValue: StepOutput | null;
  lastStatus: "ok" | "error" | "skipped" | "running" | "interrupted";
  lastError: string | null;
  runCount: number;
  consecutiveFailures: number;
}


// ── State history (JSONL entry appended after each run) ──────────────

export interface StateHistoryEntry {
  timestamp: string;
  status: "ok" | "error" | "skipped";
  value: StepOutput | null;
  runCount: number;
  error: string | null;
}

import fss from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  JournalEvent,
  JournalStepEnd,
  JournalStepOutput,
} from '../types/state.js';
import { runLockPath } from '../paths.js';

// ── Append (synchronous) ────────────────────────────────────────────

export function appendEvent(pipelineName: string, event: JournalEvent): void {
  const p = runLockPath(pipelineName);
  fss.mkdirSync(path.dirname(p), { recursive: true });
  fss.appendFileSync(p, JSON.stringify(event) + '\n');
}

// ── Read ────────────────────────────────────────────────────────────

export async function readJournal(
  pipelineName: string,
): Promise<JournalEvent[]> {
  const p = runLockPath(pipelineName);
  let raw: string;
  try {
    raw = await fsp.readFile(p, 'utf-8');
  } catch {
    return [];
  }

  const lines = raw.split('\n');
  const events: JournalEvent[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      events.push(JSON.parse(line) as JournalEvent);
    } catch {
      // Tolerate only a truncated last line (mid-line corruption at EOF).
      if (
        i === lines.length - 1 ||
        lines.slice(i + 1).every((l) => !l.trim())
      ) {
        break;
      }
      // Non-tail corruption — still drop and continue for resilience.
    }
  }
  return events;
}

// ── Crash detection ─────────────────────────────────────────────────

export async function hasCrashedRun(pipelineName: string): Promise<boolean> {
  const events = await readJournal(pipelineName);
  if (events.length === 0) return false;
  return !events.some((e) => e.type === 'run_end');
}

// ── Clear ───────────────────────────────────────────────────────────

export async function clearJournal(pipelineName: string): Promise<void> {
  const events = await readJournal(pipelineName);

  // Unlink any context_file paths referenced in the journal.
  for (const e of events) {
    if (e.type === 'context_file') {
      try {
        await fsp.unlink(e.path);
      } catch {
        // Already gone — fine.
      }
    }
  }

  try {
    await fsp.unlink(runLockPath(pipelineName));
  } catch {
    // Already gone — fine.
  }
}

// ── Query helpers ───────────────────────────────────────────────────

export function lastCompletedStep(events: JournalEvent[]): string | null {
  let last: string | null = null;
  for (const e of events) {
    if (e.type === 'step_end') {
      last = (e as JournalStepEnd).name;
    }
  }
  return last;
}

export function hydrateStepsFromJournal(
  events: JournalEvent[],
): Record<string, unknown> {
  // Find the index of the last step_end to cap hydration.
  let lastEndIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'step_end') {
      lastEndIdx = i;
      break;
    }
  }

  const steps: Record<string, unknown> = {};
  for (let i = 0; i <= lastEndIdx; i++) {
    const e = events[i];
    if (e.type === 'step_output') {
      steps[(e as JournalStepOutput).name] = (e as JournalStepOutput).output;
    }
  }
  return steps;
}

export async function truncateJournalToRunStart(
  pipelineName: string,
  runId: string,
): Promise<void> {
  const p = runLockPath(pipelineName);
  const events = await readJournal(pipelineName);
  const keep = events.find((e) => e.type === 'run_start' && e.runId === runId);
  if (!keep) {
    try {
      fss.unlinkSync(p);
    } catch {}
    return;
  }
  fss.writeFileSync(p, JSON.stringify(keep) + '\n');
}

export function lastStepOutputFromJournal(events: JournalEvent[]): unknown {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'step_output') return (e as { output: unknown }).output;
  }
  return {};
}

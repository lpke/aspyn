import fs from "node:fs/promises";

import type { WatchState, StateHistoryEntry } from "../types/state.js";
import type { PipelineResult } from "../types/pipeline.js";
import { getStatePath, getWatchStateDir, getStateHistoryPath } from "../config/paths.js";

// ── Defaults ────────────────────────────────────────────────────────

function defaultState(): WatchState {
  return {
    lastRun: null,
    lastValue: null,
    lastStatus: "ok",
    lastError: null,
    runCount: 0,
    consecutiveFailures: 0,
  };
}

// ── Public API ──────────────────────────────────────────────────────

export async function loadState(watchName: string): Promise<WatchState> {
  const filePath = getStatePath(watchName);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as WatchState;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultState();
    }
    throw err;
  }
}

export async function saveState(
  watchName: string,
  state: WatchState,
): Promise<void> {
  const filePath = getStatePath(watchName);
  const dir = getWatchStateDir(watchName);
  await fs.mkdir(dir, { recursive: true });

  const tmpPath = filePath + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf-8");
  await fs.rename(tmpPath, filePath);
}

export async function resetState(watchName: string): Promise<void> {
  const filePath = getStatePath(watchName);
  try {
    await fs.unlink(filePath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  await clearStateHistory(watchName);
}

export function isFirstRun(state: WatchState): boolean {
  return state.lastRun === null;
}

export async function markRunning(
  watchName: string,
  state: WatchState,
): Promise<WatchState> {
  const updated: WatchState = { ...state, lastStatus: "running" };
  await saveState(watchName, updated);
  return updated;
}

export async function markComplete(
  watchName: string,
  state: WatchState,
  result: PipelineResult,
): Promise<WatchState> {
  const updated: WatchState = {
    lastRun: new Date().toISOString(),
    lastStatus: result.skipped ? "skipped" : result.success ? "ok" : "error",
    lastValue: result.value ?? state.lastValue,
    lastError: result.error,
    runCount: state.runCount + 1,
    consecutiveFailures:
      result.success || result.skipped
        ? 0
        : state.consecutiveFailures + 1,
  };
  await saveState(watchName, updated);

  const entry: StateHistoryEntry = {
    timestamp: updated.lastRun!,
    status: updated.lastStatus as "ok" | "error" | "skipped",
    value: result.value ?? null,
    runCount: updated.runCount,
    error: result.error ?? null,
  };
  await appendStateHistory(watchName, entry);

  return updated;
}


export async function appendStateHistory(
  watchName: string,
  entry: StateHistoryEntry,
): Promise<void> {
  const dir = getWatchStateDir(watchName);
  await fs.mkdir(dir, { recursive: true });
  const filePath = getStateHistoryPath(watchName);
  await fs.appendFile(filePath, JSON.stringify(entry) + "\n", "utf-8");
}

export async function clearStateHistory(
  watchName: string,
): Promise<void> {
  const filePath = getStateHistoryPath(watchName);
  try {
    await fs.unlink(filePath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

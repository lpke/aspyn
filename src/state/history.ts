import fs from 'node:fs/promises';
import fss from 'node:fs';

import type { StateHistoryEntry } from '../types/state.js';
import type { StateHistoryConfig } from '../types/config.js';
import { stateDir, stateHistoryPath } from '../paths.js';
import { rotateIfNeededSync } from '../logger.js';
import {
  DEFAULT_ROTATION_MAX_FILE_SIZE,
  DEFAULT_ROTATION_MAX_FILES,
  STATE_HISTORY_FILE,
} from '../constants.js';

// ── Append (synchronous) ────────────────────────────────────────────

export function appendHistory(
  pipelineName: string,
  entry: StateHistoryEntry,
  rotationCfg: StateHistoryConfig,
): void {
  const dir = stateDir(pipelineName);
  fss.mkdirSync(dir, { recursive: true });

  const filePath = stateHistoryPath(pipelineName);
  const maxFileSize = rotationCfg.maxFileSize ?? DEFAULT_ROTATION_MAX_FILE_SIZE;
  const maxFiles = rotationCfg.maxFiles ?? DEFAULT_ROTATION_MAX_FILES;

  rotateIfNeededSync(filePath, maxFileSize, maxFiles);
  fss.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
}

// ── Read ────────────────────────────────────────────────────────────

export interface ReadHistoryOpts {
  limit?: number;
  offset?: number;
  statusFilter?: string;
  sinceIso?: string;
  untilIso?: string;
}

export async function readHistory(
  pipelineName: string,
  opts: ReadHistoryOpts = {},
): Promise<StateHistoryEntry[]> {
  const basePath = stateHistoryPath(pipelineName);

  // Collect entries from current + rotated files (newest first)
  const entries: StateHistoryEntry[] = [];

  // Determine which files exist: base, base.1, base.2, …
  const files: string[] = [];
  if (fileExists(basePath)) files.push(basePath);
  for (let i = 1; ; i++) {
    const rotated = `${basePath}.${i}`;
    if (!fileExists(rotated)) break;
    files.push(rotated);
  }

  for (const file of files) {
    const raw = await fs.readFile(file, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    // Lines within a file are oldest-first; reverse for newest-first
    for (let i = lines.length - 1; i >= 0; i--) {
      entries.push(JSON.parse(lines[i]) as StateHistoryEntry);
    }
  }

  // Apply filters
  let filtered = entries;

  if (opts.statusFilter) {
    filtered = filtered.filter((e) => e.status === opts.statusFilter);
  }
  if (opts.sinceIso) {
    const since = opts.sinceIso;
    filtered = filtered.filter((e) => e.startedAt >= since);
  }
  if (opts.untilIso) {
    const until = opts.untilIso;
    filtered = filtered.filter((e) => e.startedAt <= until);
  }

  // Pagination
  const offset = opts.offset ?? 0;
  const sliced = filtered.slice(offset);
  return opts.limit != null ? sliced.slice(0, opts.limit) : sliced;
}

// ── Clear ───────────────────────────────────────────────────────────

export async function clearHistory(pipelineName: string): Promise<void> {
  const basePath = stateHistoryPath(pipelineName);

  // Remove base file
  await unlinkSafe(basePath);

  // Remove rotated files
  for (let i = 1; ; i++) {
    const rotated = `${basePath}.${i}`;
    try {
      await fs.unlink(rotated);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw err;
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function fileExists(p: string): boolean {
  try {
    fss.statSync(p);
    return true;
  } catch {
    return false;
  }
}

async function unlinkSafe(p: string): Promise<void> {
  try {
    await fs.unlink(p);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

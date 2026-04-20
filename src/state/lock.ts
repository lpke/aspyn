import * as fs from 'node:fs';
import * as path from 'node:path';
import { concurrencyLockPath } from '../paths.js';
import { LOCK_MAX_AGE_MS } from '../constants.js';

export type LockHandle = { path: string; pid: number };

export async function isStaleLock(path: string): Promise<boolean> {
  try {
    const stat = fs.statSync(path);
    if (Date.now() - stat.mtimeMs > LOCK_MAX_AGE_MS) return true;
  } catch {
    return true;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(path, 'utf-8');
  } catch {
    return true;
  }
  const pid = parseInt(raw.trim(), 10);
  if (Number.isNaN(pid)) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') return true;
    // EPERM means process exists but we lack permission — not stale
    return false;
  }
}

export async function acquireLock(
  pipelineName: string,
): Promise<LockHandle | null> {
  const lockPath = concurrencyLockPath(pipelineName);
  const pid = process.pid;

  // If lock file exists, check staleness
  if (fs.existsSync(lockPath)) {
    if (await isStaleLock(lockPath)) {
      fs.unlinkSync(lockPath);
    } else {
      return null;
    }
  }

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  // Atomic create with O_EXCL (wx flag)
  try {
    fs.writeFileSync(lockPath, String(pid) + '\n', { flag: 'wx' });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // Race: another process grabbed it between our check and write
      return null;
    }
    throw err;
  }

  return { path: lockPath, pid };
}

export async function releaseLock(handle: LockHandle): Promise<void> {
  try {
    const raw = fs.readFileSync(handle.path, 'utf-8');
    const pid = parseInt(raw.trim(), 10);
    if (pid !== handle.pid) return;
    fs.unlinkSync(handle.path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
}

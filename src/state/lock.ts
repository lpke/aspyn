import fs from "node:fs/promises";
import path from "node:path";

import {
  getLockPath,
  getStateDir,
  getWatchStateDir,
} from "../config/paths.js";

// ── Helpers ─────────────────────────────────────────────────────────

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ── Public API ──────────────────────────────────────────────────────

export async function acquireLock(watchName: string): Promise<boolean> {
  const lockPath = getLockPath(watchName);
  const dir = getWatchStateDir(watchName);
  await fs.mkdir(dir, { recursive: true });

  const myPid = String(process.pid);

  try {
    const raw = await fs.readFile(lockPath, "utf-8");
    const pid = Number(raw.trim());

    if (Number.isNaN(pid)) {
      // Corrupt lock file — overwrite it
      await fs.writeFile(lockPath, myPid + "\n", "utf-8");
      return true;
    }

    if (pidIsAlive(pid)) {
      return false;
    }

    // Stale lock — overwrite
    await fs.writeFile(lockPath, myPid + "\n", "utf-8");
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.writeFile(lockPath, myPid + "\n", "utf-8");
      return true;
    }
    throw err;
  }
}

export async function releaseLock(watchName: string): Promise<void> {
  const lockPath = getLockPath(watchName);
  const myPid = String(process.pid);

  try {
    const raw = await fs.readFile(lockPath, "utf-8");
    if (raw.trim() !== myPid) return;
    await fs.unlink(lockPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

export async function cleanStaleLocks(): Promise<string[]> {
  const stateDir = getStateDir();
  const cleaned: string[] = [];

  let entries: string[];
  try {
    entries = await fs.readdir(stateDir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return cleaned;
    throw err;
  }

  for (const name of entries) {
    const lockPath = path.join(stateDir, name, "lock");

    let raw: string;
    try {
      raw = await fs.readFile(lockPath, "utf-8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }

    const pid = Number(raw.trim());
    if (Number.isNaN(pid) || !pidIsAlive(pid)) {
      try {
        await fs.unlink(lockPath);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
      cleaned.push(name);
    }
  }

  return cleaned;
}

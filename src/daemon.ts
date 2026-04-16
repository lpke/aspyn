import cron from "node-cron";

import { runWatch } from "./runner.js";
import { loadGlobalConfig, loadWatchConfig, discoverWatches } from "./config/loader.js";
import { validateWatchConfig } from "./config/validator.js";
import { loadState, saveState } from "./state/manager.js";
import { cleanStaleLocks, releaseLock } from "./state/lock.js";
import { clampInterval, shorthandToCron, intervalToMs } from "./scheduling/interval.js";
import type { MissedRunPolicy } from "./types/config.js";
import type { WatchState } from "./types/state.js";
import { logger, createLogger } from "./logger.js";

// ── Missed-run handling ─────────────────────────────────────────────

async function handleMissedRuns(
  name: string,
  policy: MissedRunPolicy,
  state: WatchState,
  intervalMs: number,
): Promise<void> {
  if (!state.lastRun) return;

  const elapsed = Date.now() - new Date(state.lastRun).getTime();
  if (elapsed <= intervalMs) return;

  const watchLog = createLogger({ prefix: name });

  if (policy === "skip") {
    watchLog.info("Overdue — skipping (policy: skip)");
    return;
  }

  if (policy === "run_once") {
    watchLog.info("Overdue — running once (policy: run_once)");
    await runWatch(name);
    return;
  }

  if (policy === "run_all") {
    const missedCount = Math.floor(elapsed / intervalMs);
    const capped = Math.min(missedCount, 10);
    if (missedCount > 10) {
      watchLog.info(`Overdue — ${missedCount} runs missed, capping at 10 (policy: run_all)`);
    } else {
      watchLog.info(`Overdue — running ${capped} missed run(s) (policy: run_all)`);
    }
    for (let i = 0; i < capped; i++) {
      await runWatch(name);
    }
  }
}

// ── Daemon entrypoint ───────────────────────────────────────────────

export async function cmdDaemon(): Promise<void> {
  // 1. Clean stale locks
  const cleaned = await cleanStaleLocks();
  for (const name of cleaned) {
    logger.warn(`Cleaned stale lock for ${name}`);
  }

  // 2. Load global config
  const globalConfig = await loadGlobalConfig();
  const shutdownTimeout = (globalConfig.shutdownTimeout ?? 30) * 1000;

  // 3. Track scheduled tasks and in-progress runs
  const tasks = new Map<string, cron.ScheduledTask>();
  const inProgressRuns = new Set<Promise<unknown>>();

  async function scheduleWatch(name: string): Promise<void> {
    const watchLog = createLogger({ prefix: name });
    try {
      const config = await loadWatchConfig(name);
      validateWatchConfig(config, name);
      config.interval = clampInterval(config.interval, globalConfig.minInterval ?? "10s");
      const expression = shorthandToCron(config.interval);
      const intervalMs = intervalToMs(config.interval);

      // Handle interrupted state (stale "running" from a crash)
      let state = await loadState(name);
      if (state.lastStatus === "running") {
        watchLog.info("Detected interrupted state — marking as interrupted");
        state = { ...state, lastStatus: "interrupted" };
        await saveState(name, state);
      }

      // Check for overdue runs
      const missedPolicy = config.missedRunPolicy ?? globalConfig.missedRunPolicy ?? "run_once";
      await handleMissedRuns(name, missedPolicy, state, intervalMs);

      const task = cron.schedule(expression, () => {
        let resolve: () => void;
        const promise = new Promise<void>((r) => { resolve = r; });
        inProgressRuns.add(promise);
        (async () => {
          try {
            const result = await runWatch(name);
            const status = result.skipped ? "skipped" : result.success ? "ok" : "error";
            watchLog.info(status);
          } catch (err) {
            watchLog.error((err as Error).message);
          } finally {
            inProgressRuns.delete(promise);
            resolve!();
          }
        })();
      });

      tasks.set(name, task);
    } catch (err) {
      watchLog.error(`Failed to schedule: ${(err as Error).message}`);
    }
  }

  // 4. Discover and schedule all watches
  const watches = await discoverWatches();
  for (const name of watches) {
    await scheduleWatch(name);
  }

  logger.info(`Daemon started. Watching ${tasks.size} watches.`);

  // 5. Discovery sweep every 60 seconds
  const discoveryInterval = setInterval(async () => {
    const current = await discoverWatches();
    const currentSet = new Set(current);

    for (const name of current) {
      if (!tasks.has(name)) {
        logger.info(`New watch detected: ${name}`);
        await scheduleWatch(name);
      }
    }

    for (const [name, task] of tasks) {
      if (!currentSet.has(name)) {
        logger.info(`Watch removed: ${name}`);
        task.stop();
        tasks.delete(name);
      }
    }
  }, 60_000);

  // 6. Graceful shutdown
  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) {
      logger.error("Force exit.");
      process.exit(1);
    }
    shuttingDown = true;

    logger.info("Shutting down...");

    // Stop accepting new runs
    clearInterval(discoveryInterval);
    for (const [, task] of tasks) {
      task.stop();
    }

    // Wait for in-progress runs with timeout
    if (inProgressRuns.size > 0) {
      logger.info(`Waiting for ${inProgressRuns.size} in-progress run(s)...`);
      const timeout = new Promise<void>((r) => setTimeout(r, shutdownTimeout));
      await Promise.race([
        Promise.allSettled([...inProgressRuns]),
        timeout,
      ]);
      if (inProgressRuns.size > 0) {
        logger.warn(`Timed out waiting for ${inProgressRuns.size} run(s)`);
      }
    }

    // Release all locks forcefully
    const allWatches = await discoverWatches();
    for (const name of allWatches) {
      try {
        await releaseLock(name);
      } catch { /* best effort */ }
    }

    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

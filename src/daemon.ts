import cron from 'node-cron';
import {
  listPipelineNames,
  loadPipelineConfig,
  loadGlobalConfig,
} from './config/loader.js';
import { runPipeline } from './pipeline/engine.js';
import { readState, writeState } from './state/state.js';
import { hasCrashedRun } from './state/journal.js';
import { parseDurationMs } from './duration.js';
import { logger, initGlobalLogger } from './logger.js';
import {
  MIN_INTERVAL,
  DAEMON_PIPELINE_SCAN_INTERVAL_MS,
  SHUTDOWN_TIMEOUT_MS,
  RUN_STATUS_INTERRUPTED,
} from './constants.js';
import type { PipelineConfig, MissedRunPolicy } from './types/config.js';
import type { PipelineState } from './types/state.js';

// ── Interval → cron expression ──────────────────────────────────────

function intervalToCron(interval: string): string | null {
  // Already a cron expression (5-6 fields)?
  if (cron.validate(interval)) return interval;

  const ms = parseDurationMs(interval);
  const minMs = parseDurationMs(MIN_INTERVAL);
  const clampedMs = Math.max(ms, minMs);
  const secs = Math.round(clampedMs / 1_000);

  if (secs < 60) {
    // node-cron supports seconds as 6-field cron
    return `*/${secs} * * * * *`;
  }
  const mins = Math.round(secs / 60);
  if (mins < 60) return `*/${mins} * * * *`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `0 */${hours} * * *`;
  // Daily or longer → once a day
  return `0 0 * * *`;
}

// ── Crash recovery (non-interactive) ────────────────────────────────

async function daemonCrashRecovery(
  name: string,
  missedRunPolicy: MissedRunPolicy,
): Promise<void> {
  const crashed = await hasCrashedRun(name);
  if (!crashed) return;

  // Mark interrupted in persisted state
  const state = await readState(name);
  if (state) {
    const patched: PipelineState = {
      ...state,
      lastStatus: RUN_STATUS_INTERRUPTED,
    };
    await writeState(name, patched);
    logger.warn(`[${name}] Marked crashed run as interrupted`);
  }

  // Check missed-run policy for overdue pipelines
  if (missedRunPolicy === 'skip') {
    logger.info(`[${name}] missedRunPolicy=skip; skipping overdue run`);
    return;
  }

  // For run_once / run_all, the next scheduled tick will pick it up naturally.
  // run_all isn't meaningfully different in daemon context (we run once per tick).
}

// ── Tracked task ────────────────────────────────────────────────────

interface ScheduledPipeline {
  task: cron.ScheduledTask;
  running: Promise<void> | null;
  lastRunAt: number;
}

// ── Public API ──────────────────────────────────────────────────────

export async function startDaemon(opts?: { verbose?: boolean }): Promise<void> {
  if (opts?.verbose) {
    initGlobalLogger({ level: 'debug' });
  }

  const globalCfg = await loadGlobalConfig();
  const scheduled = new Map<string, ScheduledPipeline>();
  let shuttingDown = false;

  // ── Schedule a single pipeline ──────────────────────────────────

  async function schedulePipeline(name: string): Promise<void> {
    let cfg: PipelineConfig;  // let: reassigned when interval changes
    try {
      cfg = await loadPipelineConfig(name);
    } catch (err) {
      logger.warn(
        `[${name}] Failed to load config, skipping: ${(err as Error).message}`,
      );
      return;
    }

    if (!cfg.interval) {
      logger.debug(`[${name}] No interval; manual-run-only, skipping`);
      return;
    }

    const cronExpr = intervalToCron(cfg.interval);
    if (!cronExpr) {
      logger.warn(
        `[${name}] Could not convert interval "${cfg.interval}" to cron; skipping`,
      );
      return;
    }

    // Run crash recovery before first schedule
    await daemonCrashRecovery(name, globalCfg.missedRunPolicy);

    // Seed lastRunAt from persisted state so missed-run catch-up works after downtime
    let seedLastRunAt = Date.now();
    try {
      const persistedState = await readState(name);
      if (persistedState?.lastRun) {
        const parsed = Date.parse(persistedState.lastRun);
        if (!isNaN(parsed)) seedLastRunAt = parsed;
      }
    } catch {
      // Fall back to Date.now() for fresh pipelines
    }

    const entry: ScheduledPipeline = { task: null!, running: null, lastRunAt: seedLastRunAt };

    const tickCallback = async () => {
      if (shuttingDown) return;
      if (entry.running) {
        logger.debug(`[${name}] Previous run still in progress, skipping tick`);
        return;
      }
      entry.running = (async () => {
        try {
          // Reload config each tick so on-disk edits are observed
          let tickCfg: PipelineConfig;
          try {
            tickCfg = await loadPipelineConfig(name);
          } catch (loadErr) {
            logger.warn(`[${name}] Failed to reload config, skipping tick: ${(loadErr as Error).message}`);
            return;
          }

          if (!tickCfg.interval) {
            logger.warn(`[${name}] interval removed from config, skipping tick`);
            return;
          }

          if (tickCfg.interval !== cfg.interval) {
            logger.info(`[${name}] interval changed: "${cfg.interval}" \u2192 "${tickCfg.interval}"`);
            const newCron = intervalToCron(tickCfg.interval!);
            if (!newCron) {
              logger.warn(`[${name}] Could not convert new interval "${tickCfg.interval}" to cron; keeping existing schedule`);
            } else {
              entry.task.stop();
              cfg = tickCfg;
              const newTask = cron.schedule(newCron, tickCallback);
              entry.task = newTask;
              scheduled.set(name, entry);
              logger.info(`[${name}] Re-scheduled with cron "${newCron}"`);
              return; // let the new schedule drive the next tick
            }
          }

          const intervalMs = parseDurationMs(tickCfg.interval);
          const now = Date.now();
          let timesToRun = 1;
          if (globalCfg.missedRunPolicy === 'run_all' && entry.lastRunAt > 0) {
            const elapsed = now - entry.lastRunAt;
            timesToRun = Math.max(1, Math.floor(elapsed / intervalMs));
          }
          // Stamp lastRunAt before running so elapsed-time catch-up
          // reflects schedule intent (time since last scheduled start),
          // not completion time \u2014 avoids inflated run_all catch-up counts.
          entry.lastRunAt = Date.now();
          for (let r = 0; r < timesToRun; r++) {
            if (shuttingDown) break;
            logger.info(`[${name}] Running pipeline${timesToRun > 1 ? ` (${r + 1}/${timesToRun})` : ''}`);
            await runPipeline(name);
          }
        } catch (err) {
          logger.error(`[${name}] Pipeline error: ${(err as Error).message}`);
        } finally {
          entry.running = null;
        }
      })();
    };

    const task = cron.schedule(cronExpr, tickCallback);

    entry.task = task;
    scheduled.set(name, entry);
    logger.info(
      `[${name}] Scheduled with cron "${cronExpr}" (interval: ${cfg.interval})`,
    );
  }

  // ── Initial scan ────────────────────────────────────────────────

  const initialNames = await listPipelineNames();
  for (const name of initialNames) {
    await schedulePipeline(name);
  }

  logger.info(`Watching ${scheduled.size} pipelines`);

  // ── Periodic re-scan for new/removed pipelines ──────────────────

  const scanTimer = setInterval(async () => {
    if (shuttingDown) return;
    try {
      const currentNames = new Set(await listPipelineNames());

      // Add new pipelines
      for (const name of currentNames) {
        if (!scheduled.has(name)) {
          logger.info(`[${name}] Detected new pipeline, scheduling`);
          await schedulePipeline(name);
        }
      }

      // Remove stale pipelines
      for (const [name, entry] of scheduled) {
        if (!currentNames.has(name)) {
          logger.info(`[${name}] Pipeline removed from disk, unscheduling`);
          entry.task.stop();
          scheduled.delete(name);
        }
      }
    } catch (err) {
      logger.error(`Pipeline scan error: ${(err as Error).message}`);
    }
  }, DAEMON_PIPELINE_SCAN_INTERVAL_MS);

  // ── Graceful shutdown ───────────────────────────────────────────

  function shutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down daemon\u2026');

    clearInterval(scanTimer);

    // Stop all cron tasks
    for (const [, entry] of scheduled) {
      entry.task.stop();
    }

    // Wait for in-flight runs
    const inFlight = [...scheduled.values()]
      .map((e) => e.running)
      .filter((p): p is Promise<void> => p !== null);

    const deadline = setTimeout(() => {
      logger.warn('Shutdown timeout reached, forcing exit');
      process.exit(0);
    }, globalCfg.shutdownTimeout ?? SHUTDOWN_TIMEOUT_MS);

    Promise.all(inFlight)
      .then(() => {
        clearTimeout(deadline);
        logger.info('All in-flight runs complete. Exiting.');
        process.exit(0);
      })
      .catch(() => {
        clearTimeout(deadline);
        process.exit(0);
      });
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the event loop alive
  await new Promise<void>(() => {});
}

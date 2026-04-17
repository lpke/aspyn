import type { PipelineResult } from "./types/pipeline.js";
import type { TypedActionHandler } from "./types/config.js";
import { loadGlobalConfig, loadWatchConfig, discoverWatches } from "./config/loader.js";
import { clampInterval } from "./scheduling/interval.js";
import { acquireLock, releaseLock } from "./state/lock.js";
import { loadState, markRunning, markComplete } from "./state/manager.js";
import { runPipeline } from "./pipeline/engine.js";
import { createLogger } from "./logger.js";
import { getRunLogPath } from "./config/paths.js";

// ── Options ─────────────────────────────────────────────────────────

export interface RunOptions {
  dryRun?: boolean;
}

// ── Result ──────────────────────────────────────────────────────────

export interface RunResult extends PipelineResult {
  dryRunActions?: Array<string | TypedActionHandler>;
}

// ── runWatch ────────────────────────────────────────────────────────

export async function runWatch(
  watchName: string,
  options?: RunOptions,
): Promise<RunResult> {
  const { dryRun = false } = options ?? {};

  // 1. Load configs
  const globalConfig = await loadGlobalConfig();
  const config = await loadWatchConfig(watchName);

  // 2. Clamp interval
  config.interval = clampInterval(
    config.interval,
    globalConfig.minInterval ?? "10s",
  );

  // 3. Create watch-scoped logger
  const watchLogger = createLogger({
    prefix: watchName,
    logFile: getRunLogPath(watchName),
    maxFileSize: config.log?.maxFileSize ?? globalConfig.log?.maxFileSize ?? "5mb",
    maxFiles: config.log?.maxFiles ?? globalConfig.log?.maxFiles ?? 5,
    level: config.log?.level ?? globalConfig.log?.level ?? "info",
  });

  watchLogger.info("Run started");

  // 4. Acquire lock
  const locked = await acquireLock(watchName);
  if (!locked) {
    watchLogger.warn("Lock held by another process — skipping.");
    return { success: true, value: null, error: null, skipped: true };
  }

  try {
    // 5. Load & mark running
    const state = await loadState(watchName);
    watchLogger.debug("Lock acquired");
    watchLogger.debug(`State loaded (run #${state.runCount + 1})`);
    if (!dryRun) await markRunning(watchName, state);

    // 6. Run pipeline
    let result: RunResult;

    if (dryRun) {
      const dryConfig = { ...config, action: "true" };
      const dryResult = await runPipeline({ watchName, config: dryConfig, globalConfig, state, logger: watchLogger });
      const actions = Array.isArray(config.action) ? config.action : [config.action];
      result = { ...dryResult, skipped: true };
      if (dryResult.success && !dryResult.skipped) {
        result.dryRunActions = actions;
      }
    } else {
      result = await runPipeline({ watchName, config, globalConfig, state, logger: watchLogger });
    }

    // 7. Mark complete
    if (!dryRun) await markComplete(watchName, state, result);

    watchLogger.info(`Run complete — ${result.skipped ? "skipped" : result.success ? "ok" : "error"}`);

    return result;
  } finally {
    await releaseLock(watchName);
  }
}

// ── runAllWatches ───────────────────────────────────────────────────

export async function runAllWatches(
  options?: RunOptions,
): Promise<Map<string, RunResult>> {
  const watches = await discoverWatches();
  const results = new Map<string, RunResult>();

  for (const name of watches) {
    try {
      const result = await runWatch(name, options);
      results.set(name, result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.set(name, {
        success: false,
        value: null,
        error,
        skipped: false,
      });
    }
  }

  return results;
}

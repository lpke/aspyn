import type { PipelineResult } from "./types/pipeline.js";
import { loadGlobalConfig, loadWatchConfig, discoverWatches } from "./config/loader.js";
import { validateWatchConfig } from "./config/validator.js";
import { clampInterval } from "./scheduling/interval.js";
import { acquireLock, releaseLock } from "./state/lock.js";
import { loadState, markRunning, markComplete } from "./state/manager.js";
import { runPipeline } from "./pipeline/engine.js";

// ── Options ─────────────────────────────────────────────────────────

export interface RunOptions {
  verbose?: boolean;
  dryRun?: boolean;
}

// ── runWatch ────────────────────────────────────────────────────────

export async function runWatch(
  watchName: string,
  options?: RunOptions,
): Promise<PipelineResult> {
  const { verbose = false, dryRun = false } = options ?? {};

  // 1. Load configs
  const globalConfig = await loadGlobalConfig();
  const config = await loadWatchConfig(watchName);

  // 2. Validate
  validateWatchConfig(config, watchName);

  // 3. Clamp interval
  config.interval = clampInterval(
    config.interval,
    globalConfig.minInterval ?? "10s",
  );

  // 4. Acquire lock
  const locked = await acquireLock(watchName);
  if (!locked) {
    console.warn(`[${watchName}] Lock held by another process — skipping.`);
    return { success: true, value: null, error: null, skipped: true };
  }

  try {
    // 5. Load & mark running
    const state = await loadState(watchName);
    if (!dryRun) await markRunning(watchName, state);

    // 6. Run pipeline
    let result: PipelineResult;

    if (dryRun) {
      // Dry-run: source + parse + check only, skip actions.
      // Run source + parse + check with a harmless no-op action
      const dryConfig = { ...config, action: "true" };
      const dryResult = await runPipeline({ watchName, config: dryConfig, globalConfig, state });
      const actions = Array.isArray(config.action) ? config.action : [config.action];
      if (dryResult.success && !dryResult.skipped) {
        console.error(
          `[${watchName}] Dry run: would execute ${actions.length} action(s):`,
        );
        for (const a of actions) {
          console.error(`  - ${typeof a === "string" ? a : JSON.stringify(a)}`);
        }
      }
      result = { ...dryResult, skipped: true };
    } else {
      result = await runPipeline({ watchName, config, globalConfig, state });
    }

    // 7. Mark complete
    if (!dryRun) await markComplete(watchName, state, result);

    // 8. Verbose output
    if (verbose) {
      console.log(JSON.stringify(result, null, 2));
    }

    return result;
  } finally {
    await releaseLock(watchName);
  }
}

// ── runAllWatches ───────────────────────────────────────────────────

/**
 * Programmatic API for running all watches sequentially.
 * Not used by the CLI (cli.ts inlines its own loop with per-watch timing and --all flag handling).
 * Exported as a public convenience for external consumers or scripts that import aspyn as a library.
 * Do not remove or refactor into the CLI — the separation is intentional.
 */
export async function runAllWatches(
  options?: RunOptions,
): Promise<Map<string, PipelineResult>> {
  const watches = await discoverWatches();
  const results = new Map<string, PipelineResult>();

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

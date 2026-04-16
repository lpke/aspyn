import type {
  WatchConfig,
  GlobalConfig,
  TypedSourceHandler,
  TypedParseHandler,
  TypedCheckHandler,
  TypedActionHandler,
} from "../types/config.js";
import type {
  StepOutput,
  PipelineContext,
  PipelineResult,
} from "../types/pipeline.js";
import type { WatchState } from "../types/state.js";
import type { Logger } from "../logger.js";
import { getWatchDir } from "../config/paths.js";
import { execShell, parseJsonOutput } from "../execution/shell.js";
import { resolveSource } from "../handlers/sources/resolve.js";
import { resolveParse } from "../handlers/parsers/resolve.js";
import { resolveCheck } from "../handlers/checks/resolve.js";
import { exprCheck } from "../handlers/checks/expr.js";
import { resolveAction } from "../handlers/actions/resolve.js";
import { withRetry } from "./retry.js";
import { logger as globalLogger } from "../logger.js";

// ── Options ─────────────────────────────────────────────────────────

export interface PipelineOptions {
  watchName: string;
  config: WatchConfig;
  globalConfig: GlobalConfig;
  state: WatchState;
  logger?: Logger;
}

// ── Helpers ─────────────────────────────────────────────────────────

function looksLikeBareExpression(check: string): boolean {
  return !check.includes("/") && !check.startsWith("#!");
}

// ── Pipeline engine ─────────────────────────────────────────────────

export async function runPipeline(
  options: PipelineOptions,
): Promise<PipelineResult> {
  const { watchName, config, globalConfig, state } = options;
  const log = options.logger ?? globalLogger;

  const timeout = config.timeout ?? globalConfig.defaultTimeout ?? 30;
  const cwd = getWatchDir(watchName);

  try {
    log.info("Pipeline started");

    // ── 1. Source ──────────────────────────────────────────────────

    log.debug(`Source: ${config.source === undefined ? "none" : typeof config.source === "string" ? "shell" : (config.source as TypedSourceHandler).type}`);

    const sourceOutput: StepOutput = await withRetry(async () => {
      if (config.source === undefined) return {};

      if (typeof config.source === "string") {
        const result = await execShell({ command: config.source, cwd, timeout });
        if (result.exitCode !== 0) {
          throw new Error(
            `Source command exited with code ${result.exitCode}: ${result.stderr}`,
          );
        }
        return parseJsonOutput(result.stdout) ?? { raw: result.stdout };
      }

      return resolveSource(
        config.source as TypedSourceHandler,
        cwd,
        timeout,
        globalConfig,
        log,
      );
    }, config.retry, log);

    log.debug("Source complete");

    // ── 2. Parse ──────────────────────────────────────────────────

    log.debug(`Parse: ${config.parse === undefined ? "passthrough" : typeof config.parse === "string" ? "shell" : (config.parse as TypedParseHandler).type}`);

    const parseOutput: StepOutput = await withRetry(async () => {
      if (config.parse === undefined) return sourceOutput;

      if (typeof config.parse === "string") {
        const result = await execShell({
          command: config.parse,
          cwd,
          stdin: JSON.stringify(sourceOutput),
          timeout,
        });
        if (result.exitCode !== 0) {
          throw new Error(
            `Parse command exited with code ${result.exitCode}: ${result.stderr}`,
          );
        }
        return parseJsonOutput(result.stdout) ?? { raw: result.stdout };
      }

      return resolveParse(config.parse as TypedParseHandler, sourceOutput, log);
    }, config.retry, log);

    log.debug("Parse complete");

    // ── 3. Build context ──────────────────────────────────────────

    const changed =
      JSON.stringify(parseOutput) !== JSON.stringify(state.lastValue);
    const firstRun = state.lastRun === null;

    const context: PipelineContext = {
      value: parseOutput,
      prev: state.lastValue,
      changed,
      firstRun,
      meta: {
        watch: watchName,
        timestamp: new Date().toISOString(),
        interval: config.interval,
      },
    };

    // ── 4. Check ──────────────────────────────────────────────────

    const shouldSkip: boolean = await withRetry(async () => {
      if (config.check === undefined) return false;

      if (typeof config.check === "string") {
        if (looksLikeBareExpression(config.check)) {
          return !exprCheck(config.check, context, log);
        }

        const result = await execShell({
          command: config.check,
          cwd,
          stdin: JSON.stringify(context),
          timeout,
        });
        return result.exitCode !== 0;
      }

      return !resolveCheck(config.check as TypedCheckHandler, context, log);
    }, config.retry, log);

    log.debug(`Check: ${shouldSkip ? "skip" : "pass"}`);

    if (shouldSkip) {
      log.info("Pipeline finished \u2014 skipped");
      return { success: true, value: parseOutput, error: null, skipped: true };
    }

    // ── 5. Action ─────────────────────────────────────────────────

    const actions: Array<string | TypedActionHandler> = Array.isArray(
      config.action,
    )
      ? config.action
      : [config.action];

    log.debug(`Actions: ${actions.length} action(s)`);

    for (const action of actions) {
      if (typeof action === "string") {
        const result = await execShell({
          command: action,
          cwd,
          stdin: JSON.stringify(context),
          timeout,
        });
        if (result.exitCode !== 0) {
          throw new Error(
            `Action command exited with code ${result.exitCode}: ${result.stderr}`,
          );
        }
      } else {
        await resolveAction(
          action as TypedActionHandler,
          context,
          cwd,
          watchName,
          timeout,
          log,
          config.log?.maxFileSize ?? globalConfig.log?.maxFileSize,
          config.log?.maxFiles ?? globalConfig.log?.maxFiles,
        );
      }
      log.debug(`Action complete: ${typeof action === "string" ? "shell" : (action as TypedActionHandler).type}`);
    }

    // ── 6. Success ────────────────────────────────────────────────

    log.info("Pipeline finished \u2014 ok");
    return { success: true, value: parseOutput, error: null, skipped: false };
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : String(err);

    log.error(`Pipeline failed: ${errorMessage}`);

    // ── onError handler ─────────────────────────────────────────
    if (config.onError !== undefined) {
      try {
        log.info("onError handler fired");
        await runOnError(
          config.onError,
          cwd,
          watchName,
          timeout,
          err,
          log,
          config.log?.maxFileSize ?? globalConfig.log?.maxFileSize,
          config.log?.maxFiles ?? globalConfig.log?.maxFiles,
        );
      } catch {
        // onError itself failed \u2014 swallow to avoid recursion.
      }
    }

    return { success: false, value: null, error: errorMessage, skipped: false };
  }
}

// ── onError dispatch ────────────────────────────────────────────────

async function runOnError(
  handler: string | TypedActionHandler,
  cwd: string,
  watchName: string,
  timeout: number,
  pipelineError: unknown,
  log?: Logger,
  maxFileSize?: string,
  maxFiles?: number,
): Promise<void> {
  const errorMessage =
    pipelineError instanceof Error ? pipelineError.message : String(pipelineError);

  // Build a minimal context for the error handler.
  const errorContext: PipelineContext = {
    value: { error: errorMessage },
    prev: null,
    changed: true,
    firstRun: false,
    meta: {
      watch: watchName,
      timestamp: new Date().toISOString(),
      interval: "",
    },
  };

  if (typeof handler === "string") {
    const result = await execShell({
      command: handler,
      cwd,
      stdin: JSON.stringify(errorContext),
      timeout,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `onError command exited with code ${result.exitCode}: ${result.stderr}`,
      );
    }
  } else {
    await resolveAction(
      handler as TypedActionHandler,
      errorContext,
      cwd,
      watchName,
      timeout,
      log,
      maxFileSize,
      maxFiles,
    );
  }
}

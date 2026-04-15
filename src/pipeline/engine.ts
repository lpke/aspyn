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
import { getWatchDir } from "../config/paths.js";
import { execShell, parseJsonOutput } from "../execution/shell.js";
import { resolveSource } from "../handlers/sources/resolve.js";
import { resolveParse } from "../handlers/parsers/resolve.js";
import { resolveCheck } from "../handlers/checks/resolve.js";
import { exprCheck } from "../handlers/checks/expr.js";
import { resolveAction } from "../handlers/actions/resolve.js";
import { withRetry } from "./retry.js";

// ── Options ─────────────────────────────────────────────────────────

export interface PipelineOptions {
  watchName: string;
  config: WatchConfig;
  globalConfig: GlobalConfig;
  state: WatchState;
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

  const timeout = config.timeout ?? globalConfig.defaultTimeout ?? 30;
  const cwd = getWatchDir(watchName);

  try {
    // ── 1. Source ──────────────────────────────────────────────────

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
      );
    }, config.retry);

    // ── 2. Parse ──────────────────────────────────────────────────

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

      return resolveParse(config.parse as TypedParseHandler, sourceOutput);
    }, config.retry);

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
          return !exprCheck(config.check, context);
        }

        const result = await execShell({
          command: config.check,
          cwd,
          stdin: JSON.stringify(context),
          timeout,
        });
        return result.exitCode !== 0;
      }

      return !resolveCheck(config.check as TypedCheckHandler, context);
    }, config.retry);

    if (shouldSkip) {
      return { success: true, value: parseOutput, error: null, skipped: true };
    }

    // ── 5. Action ─────────────────────────────────────────────────

    const actions: Array<string | TypedActionHandler> = Array.isArray(
      config.action,
    )
      ? config.action
      : [config.action];

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
        );
      }
    }

    // ── 6. Success ────────────────────────────────────────────────

    return { success: true, value: parseOutput, error: null, skipped: false };
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : String(err);

    // ── onError handler ─────────────────────────────────────────
    if (config.onError !== undefined) {
      try {
        await runOnError(config.onError, cwd, watchName, timeout, err);
      } catch {
        // onError itself failed — swallow to avoid recursion.
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
    );
  }
}

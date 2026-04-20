import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import "../handlers/register-all.js";

import { isDeepStrictEqual } from "node:util";
import { ulid } from "ulidx";
import { loadPipelineConfig, loadGlobalConfig } from "../config/loader.js";
import { acquireLock, releaseLock } from "../state/lock.js";
import { readState, writeState } from "../state/state.js";
import {
  appendEvent,
  hasCrashedRun,
  clearJournal,
  lastCompletedStep,
  hydrateStepsFromJournal,
  readJournal,
  truncateJournalToRunStart,
  lastStepOutputFromJournal,
} from "../state/journal.js";
import { appendHistory } from "../state/history.js";
import { lookup } from "../handlers/registry.js";
import { createEngine, type ExprEngine } from "../expr/engine.js";
import { resolveRuntime } from "../template/resolve.js";
import { parseDurationMs } from "../duration.js";
import { contextFilePath } from "../paths.js";
import { logger } from "../logger.js";
import type {
  PipelineConfig,
  StepObject,
  RetrySpec,
  GlobalConfig,
  Step,
} from "../types/config.js";
import type {
  PipelineContext,
  StepOutput,
  Halt,
  SoftError,
  RunStatus,
  RunOptions,
  RunResult,
  OnceResult,
} from "../types/pipeline.js";
import { isHandlerHalt } from "../types/pipeline.js";
import type {
  PipelineState,
  StateHistoryEntry,
} from "../types/state.js";
import {
  DEFAULT_TIMEOUT_SECONDS,
  RUN_STATUS_OK,
  RUN_STATUS_ERROR,
  RUN_STATUS_HALTED,
  RUN_STATUS_INTERRUPTED,
  RUN_STATUS_SKIPPED,
  GATE_HANDLER_TYPE,
  HALT_REASON_GATE_FALSY,
  HALT_REASON_EXPR_THROW,
  HALT_REASON_HANDLER_THROW,
  HALT_REASON_ASPYN_LEVEL,
} from "../constants.js";

export type { RunOptions, RunResult };

// ── Helpers ─────────────────────────────────────────────────────────

function generateRunId(): string {
  return ulid();
}

function nowIso(): string {
  return new Date().toISOString();
}

function normaliseStep(step: Step, index: number, fallbackName?: string): StepObject {
  if (typeof step === "string") {
    return { name: fallbackName ?? `step-${index}`, type: "shell", input: step };
  }
  if (!step.name) {
    return { ...step, name: fallbackName ?? `step-${index}` };
  }
  return step;
}

function backoffDelay(spec: RetrySpec, attempt: number): number {
  const baseMs = parseDurationMs(spec.initialDelay);
  switch (spec.backoff) {
    case "linear":
      return baseMs * attempt;
    case "exponential":
      return baseMs * 2 ** (attempt - 1);
    default:
      return baseMs;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isTracked(
  step: StepObject,
  handler: { sideEffectDefault?: boolean } | undefined,
  index: number,
  total: number,
): boolean {
  if (step.track !== undefined) return step.track;
  const sideEffect = step.sideEffect ?? handler?.sideEffectDefault ?? false;
  return sideEffect || index === total - 1;
}

function buildExprContext(ctx: PipelineContext): Record<string, unknown> {
  return {
    input: ctx.input,
    steps: ctx.steps,
    prev: ctx.prev,
    firstRun: ctx.firstRun,
    meta: ctx.meta,
    changed: ctx.changed,
    __failed: (ctx as unknown as Record<string, unknown>).__failed,
    __error: (ctx as unknown as Record<string, unknown>).__error,
  };
}

function resolveStepIndex(
  steps: StepObject[],
  ref: string | number | undefined,
  fieldName: "from" | "until",
): number | undefined {
  if (ref === undefined) return undefined;
  if (typeof ref === "number") {
    if (ref < 0 || ref >= steps.length) {
      throw new Error(`--${fieldName} index ${ref} out of range (0..${steps.length - 1})`);
    }
    return ref;
  }
  const idx = steps.findIndex((s) => s.name === ref);
  if (idx === -1) throw new Error(`--${fieldName} references unknown step "${ref}"`);
  return idx;
}

// ── Timeout helper ──────────────────────────────────────────────────

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): { result: Promise<T>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
  });

  return {
    result: Promise.race([promise, timeout]),
    cancel: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

function pipelineTimeoutError(stepName: string | null, ms: number) {
  return { message: `Pipeline timed out after ${ms}ms`, step: stepName, kind: "pipeline_timeout" as const };
}

// ── Crash recovery prompt ───────────────────────────────────────────

function promptCrashRecovery(): Promise<"continue" | "reset"> {
  if (!process.stdin.isTTY) return Promise.resolve("reset");
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question("Prior run crashed. [c]ontinue or [r]eset? [r] ", (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === "c" || a === "continue" ? "continue" : "reset");
    });
  });
}

// ── Core execution ──────────────────────────────────────────────────

async function executeStep(
  handler: ReturnType<typeof lookup>,
  ctx: PipelineContext,
  resolvedInput: unknown,
): Promise<unknown> {
  if (!handler) throw new Error("Handler not found");
  return handler.run(ctx, resolvedInput);
}

// ── runPipelineOnce (inner) ─────────────────────────────────────────

async function runPipelineOnce(
  name: string,
  opts: RunOptions,
  cfg: PipelineConfig,
  globalCfg: GlobalConfig,
  prevState: PipelineState | null,
  runId: string,
  startedAt: string,
  crashResumeSteps: Record<string, unknown>,
  crashResumeAfter: string | null,
  crashed: boolean,
  crashResumeInput: unknown,
): Promise<OnceResult> {
const allSteps = cfg.pipeline.map((s, i) => normaliseStep(s, i));
  const runNumber = (prevState?.runCount ?? 0) + 1;

  const fromIdx = resolveStepIndex(allSteps, opts.from, "from") ?? 0;
  const untilIdx = resolveStepIndex(allSteps, opts.until, "until") ?? allSteps.length - 1;

  // --from predecessor validation: ensure tracked predecessors are hydrated
  if (opts.from !== undefined && fromIdx > 0 && !opts.replaySideEffects) {
    for (let i = 0; i < fromIdx; i++) {
      const step = allSteps[i];
      const handler = lookup(step.type);
      const tracked = isTracked(step, handler, i, allSteps.length);
      if (tracked && !(step.name in crashResumeSteps)) {
        throw new Error(
          `--from: predecessor step "${step.name}" (index ${i}) has no recorded output in the journal. ` +
          `Ensure it has track: true and a prior run completed it.`,
        );
      }
    }
  }

  // --from: warn about skipped side-effect steps; --replay-side-effects overrides
  const effectiveFromIdx = (opts.from !== undefined && opts.replaySideEffects) ? 0 : fromIdx;
  if (opts.from !== undefined && !opts.replaySideEffects && fromIdx > 0) {
    for (let i = 0; i < fromIdx; i++) {
      const step = allSteps[i];
      const handler = lookup(step.type);
      const se = step.sideEffect ?? handler?.sideEffectDefault ?? false;
      if (se) {
        logger.warn(`--from: skipping side-effect step "${step.name}" (index ${i}); use --replay-side-effects to force`);
      }
    }
  }

  // Engine-local changed map (not on ctx)
  const changedMap: Record<string, boolean> = {};

  const ctx: PipelineContext & Record<string, unknown> = {
    input: crashResumeInput,
    steps: { ...crashResumeSteps },
    prev: prevState?.lastValues ? structuredClone(prevState.lastValues) : {},
    changed: changedMap,
    firstRun: !prevState,
    meta: {
      pipeline: name,
      timestamp: startedAt,
      interval: cfg.interval ?? null,
      run_number: runNumber,
    },
  };

  const engine = createEngine();
  const softErrors: SoftError[] = [];
  const warnings: Array<{ step: string; message: string }> = [];
  let finalStatus: RunStatus = RUN_STATUS_OK;
  let halt: Halt | undefined;
  let runError: { message: string; step: string | null; kind?: "pipeline_timeout" } | undefined;
  let lastValues: Record<string, StepOutput> = { ...(prevState?.lastValues ?? {}) };

  // Pipeline-level timeout (independent clock)
  const pipelineTimeoutMs = parseDurationMs(cfg.timeout ?? globalCfg.defaultTimeout);
  let pipelineTimedOut = false;
  const pipelineTimer = setTimeout(() => {
    pipelineTimedOut = true;
  }, pipelineTimeoutMs);

  try {
    let skipUntilAfterCrash = crashed && opts.continueFromCrash && crashResumeAfter !== null;

    // Track the last step that executed for timeout attribution
    let lastExecutedStep: string | null = null;

    for (let i = effectiveFromIdx; i <= untilIdx; i++) {
      if (pipelineTimedOut) {
        finalStatus = RUN_STATUS_ERROR;
        runError = pipelineTimeoutError(lastExecutedStep, pipelineTimeoutMs);
        break;
      }

      const stepDef = allSteps[i];

      if (skipUntilAfterCrash) {
        if (stepDef.name === crashResumeAfter) {
          skipUntilAfterCrash = false;
        }
        continue;
      }

      // Clear __error / __failed between steps (§3)
      ctx.__error = null;
      ctx.__failed = null;

      // Evaluate `when` condition
      if (stepDef.when) {
        const whenResult = await engine.evaluate(stepDef.when, buildExprContext(ctx));
        if (!whenResult) {
          appendEvent(name, { type: "step_start", runId, name: stepDef.name, startedAt: nowIso() });
          appendEvent(name, { type: "step_end", runId, name: stepDef.name, status: RUN_STATUS_SKIPPED, endedAt: nowIso() });
          logger.debug(`Step "${stepDef.name}" skipped (when: falsy)`);
          continue;
        }
      }

      // Resolve handler
      const handler = lookup(stepDef.type);
      if (!handler) {
        appendEvent(name, { type: "step_start", runId, name: stepDef.name, startedAt: nowIso() });
        halt = { atStep: stepDef.name, reason: HALT_REASON_ASPYN_LEVEL };
        finalStatus = RUN_STATUS_HALTED;
        runError = { message: `Unknown handler type "${stepDef.type}"`, step: stepDef.name };
        appendEvent(name, { type: "step_end", runId, name: stepDef.name, status: RUN_STATUS_HALTED, endedAt: nowIso() });
        break;
      }

      // Dry run: skip side-effect steps (§1)
const effectiveSideEffect = stepDef.sideEffect ?? handler.sideEffectDefault ?? false;
      if (opts.dry && effectiveSideEffect) {
        appendEvent(name, { type: "step_start", runId, name: stepDef.name, startedAt: nowIso() });
        appendEvent(name, { type: "step_end", runId, name: stepDef.name, status: RUN_STATUS_SKIPPED, endedAt: nowIso() });
        logger.info(`[dry] Skipping side-effect step "${stepDef.name}"`);
        ctx.steps[stepDef.name] = null;
        ctx.input = null;
        continue;
      }

      // Resolve input templates
      const resolvedInput = await resolveRuntime(
        stepDef.input,
        engine,
        buildExprContext(ctx),
      );

      // Step timeout: stepDef.timeout → globalCfg.defaultTimeout (independent of pipeline timeout)
      const stepTimeoutMs = parseDurationMs(stepDef.timeout ?? globalCfg.defaultTimeout);

      // Write context file for shell steps
      if (stepDef.type === "shell") {
        const ctxPath = contextFilePath(name);
        fs.mkdirSync(path.dirname(ctxPath), { recursive: true });
        fs.writeFileSync(ctxPath, JSON.stringify(ctx));
      }

      // Step-level retry (independent of pipeline-level retry)
      const effectiveRetry = stepDef.retry;
      const maxAttempts = effectiveRetry?.attempts ?? 1;

      let stepOutput: unknown = undefined;
      let stepError: Error | undefined;

      appendEvent(name, { type: "step_start", runId, name: stepDef.name, startedAt: nowIso() });
      lastExecutedStep = stepDef.name;

      if (stepDef.type === "shell") {
        const ctxPath = contextFilePath(name);
        ctx.__contextFile = ctxPath;
        appendEvent(name, { type: "context_file", runId, path: ctxPath });
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (pipelineTimedOut) {
          break;
        }

        try {
          const { result, cancel } = withTimeout(
            executeStep(handler, ctx, resolvedInput),
            stepTimeoutMs,
            `step "${stepDef.name}"`,
          );
          stepOutput = await result;
          cancel();
          stepError = undefined;
          break;
        } catch (err) {
          stepError = err instanceof Error ? err : new Error(String(err));
          if (attempt < maxAttempts && effectiveRetry) {
            const delay = backoffDelay(effectiveRetry, attempt);
            const msg = `Step "${stepDef.name}" attempt ${attempt} failed, retrying in ${delay}ms`;
            logger.debug(msg);
            warnings.push({ step: stepDef.name, message: msg });
            await sleep(delay);
          }
        }
      }

      // Pipeline timeout detected mid-attempt — bail out of step loop entirely
      if (pipelineTimedOut) {
        finalStatus = RUN_STATUS_ERROR;
        runError = pipelineTimeoutError(stepDef.name, pipelineTimeoutMs);
        appendEvent(name, { type: "step_end", runId, name: stepDef.name, status: RUN_STATUS_ERROR, endedAt: nowIso() });
        break;
      }

      if (stepError) {
        // Gate expr throw → halt (§9)
        if (stepDef.type === GATE_HANDLER_TYPE && !stepDef.continueOnError && !cfg.proceedOnError) {
          halt = { atStep: stepDef.name, reason: HALT_REASON_EXPR_THROW };
          finalStatus = RUN_STATUS_HALTED;
          appendEvent(name, { type: "step_end", runId, name: stepDef.name, status: RUN_STATUS_HALTED, endedAt: nowIso() });
          break;
        }

        if (stepDef.continueOnError) {
          softErrors.push({ step: stepDef.name, message: stepError.message, handled: "continueOnError" });
          ctx.__error = { step: stepDef.name, message: stepError.message };
          ctx.__failed = stepDef.name;
          appendEvent(name, { type: "step_end", runId, name: stepDef.name, status: RUN_STATUS_ERROR, endedAt: nowIso() });
          logger.warn(`Step "${stepDef.name}" failed (continueOnError): ${stepError.message}`);
          continue;
        } else if (cfg.proceedOnError) {
          softErrors.push({ step: stepDef.name, message: stepError.message, handled: "proceedOnError" });
          ctx.__error = { step: stepDef.name, message: stepError.message };
          ctx.__failed = stepDef.name;
          appendEvent(name, { type: "step_end", runId, name: stepDef.name, status: RUN_STATUS_ERROR, endedAt: nowIso() });
          logger.warn(`Step "${stepDef.name}" failed (proceedOnError): ${stepError.message}`);
          continue;
        } else {
          finalStatus = RUN_STATUS_ERROR;
          runError = { message: stepError.message, step: stepDef.name };
          appendEvent(name, { type: "step_end", runId, name: stepDef.name, status: RUN_STATUS_ERROR, endedAt: nowIso() });

          // Run step-level onError hook
          if (stepDef.onError) {
            await runOnErrorHook(stepDef.onError, name, runId, engine, ctx, stepDef.name, stepError.message);
          }
          break;
        }
      }

      // Check handler halt signal (§9)
      if (isHandlerHalt(stepOutput)) {
        halt = { atStep: stepDef.name, reason: stepOutput.reason === "aspyn_level" ? HALT_REASON_ASPYN_LEVEL : HALT_REASON_HANDLER_THROW };
        runError = { message: stepOutput.message, step: stepDef.name };
        finalStatus = RUN_STATUS_HALTED;
        appendEvent(name, { type: "step_end", runId, name: stepDef.name, status: RUN_STATUS_HALTED, endedAt: nowIso() });
        break;
      }

      // Check gate halt: expr step returning falsy
      if (stepDef.type === GATE_HANDLER_TYPE && !stepOutput) {
        halt = { atStep: stepDef.name, reason: HALT_REASON_GATE_FALSY };
        finalStatus = RUN_STATUS_HALTED;
        ctx.steps[stepDef.name] = stepOutput;
        appendEvent(name, { type: "step_end", runId, name: stepDef.name, status: RUN_STATUS_HALTED, endedAt: nowIso() });
        break;
      }

      // Success: record output
      ctx.steps[stepDef.name] = stepOutput;
      ctx.input = stepOutput;

      // Track and detect changes — only for tracked steps (§2, §11)
      const tracked = isTracked(stepDef, handler, i, allSteps.length);
      if (tracked) {
        appendEvent(name, { type: "step_output", runId, name: stepDef.name, output: stepOutput });
        const prevVal = (prevState?.lastValues ?? {})[stepDef.name];
        const changed = prevVal === undefined || !isDeepStrictEqual(prevVal, stepOutput);
        changedMap[stepDef.name] = changed;
        ctx.changed = { ...changedMap };
        lastValues[stepDef.name] = stepOutput;
      }

      appendEvent(name, { type: "step_end", runId, name: stepDef.name, status: RUN_STATUS_OK, endedAt: nowIso() });
    }

    // Pipeline-level onError hook
    if (finalStatus === RUN_STATUS_ERROR && cfg.onError && runError) {
      await runOnErrorHook(cfg.onError, name, runId, engine, ctx, runError.step ?? "(pipeline)", runError.message);
    }
  } finally {
    clearTimeout(pipelineTimer);
  }

  return {
    status: finalStatus,
    halt,
    error: runError,
    pipelineTimedOut,
    softErrors,
    warnings,
    stepOutputs: ctx.steps,
    changedMap,
    lastValues,
  };
}

// ── Main ────────────────────────────────────────────────────────────

export async function runPipeline(
  name: string,
  opts: RunOptions = {},
): Promise<RunResult> {
  const startedAt = nowIso();
  const startMs = Date.now();

  // 1. Load configs
  const cfg = await loadPipelineConfig(name);
  const globalCfg = await loadGlobalConfig();

  // 2. Acquire lock
  const lock = await acquireLock(name);
  if (!lock) {
    return { status: RUN_STATUS_INTERRUPTED, runId: "" };
  }

  // Generate runId after lock acquisition (§17)
  const runId = generateRunId();

  // Validate conflicting flags
  if (opts.from !== undefined && opts.continueFromCrash) {
    await releaseLock(lock);
    throw new Error("--from and --continue are conflicting options");
  }

  // 3. Check crashed run
  const crashed = await hasCrashedRun(name);
  if (crashed) {
    if (opts.resetCrash) {
      await clearJournal(name);
    } else if (!opts.continueFromCrash) {
      // TTY prompt
      const choice = await promptCrashRecovery();
      if (choice === "continue") {
        opts = { ...opts, continueFromCrash: true };
      } else {
        await clearJournal(name);
      }
    }
  }

  // Determine crash-resume context
  let crashResumeSteps: Record<string, unknown> = {};
  let crashResumeAfter: string | null = null;
  let crashResumeInput: unknown = {};
  if (crashed && opts.continueFromCrash) {
    const events = await readJournal(name);
    crashResumeSteps = hydrateStepsFromJournal(events);
    crashResumeAfter = lastCompletedStep(events);
    crashResumeInput = lastStepOutputFromJournal(events);
    await clearJournal(name);
  }

  // --from hydration: read journal to seed steps and input
  if (opts.from !== undefined && !crashed) {
    const events = await readJournal(name);
    if (events.length > 0) {
      const hydrated = hydrateStepsFromJournal(events);
      crashResumeSteps = hydrated;
      crashResumeInput = lastStepOutputFromJournal(events);
    }
  }

  // 4. Load state
  const prevState = await readState(name);

  // 5. Pipeline-level retry loop
  const pipelineRetry = cfg.retry;
  const pipelineMaxAttempts = pipelineRetry?.attempts ?? 1;

  let result: OnceResult | undefined;

  try {
    // Emit run_start once before the retry loop (§7)
    appendEvent(name, {
      type: "run_start",
      runId,
      pid: process.pid,
      startedAt,
    });

    for (let pAttempt = 1; pAttempt <= pipelineMaxAttempts; pAttempt++) {
      // Truncate journal to run_start between retry attempts (§7)
      if (pAttempt > 1) {
        await truncateJournalToRunStart(name, runId);
      }

      result = await runPipelineOnce(
        name, opts, cfg, globalCfg, prevState,
        runId, startedAt,
        crashResumeSteps, crashResumeAfter, crashed, crashResumeInput,
      );

      // Only retry on error (but not pipeline timeout)
      if (result.status !== RUN_STATUS_ERROR || result.pipelineTimedOut || pAttempt >= pipelineMaxAttempts) break;

      if (pipelineRetry) {
        const delay = backoffDelay(pipelineRetry, pAttempt);
        logger.debug(`Pipeline attempt ${pAttempt} failed, retrying in ${delay}ms`);
        await sleep(delay);
      }
    }

    // result is always set after loop
    const r = result!;
    const endedAt = nowIso();
    const durationMs = Date.now() - startMs;
    const runNumber = (prevState?.runCount ?? 0) + 1;

    // Journal run_end
    appendEvent(name, { type: "run_end", runId, status: r.status, endedAt });

    // State history
    const stateHistoryCfg = cfg.stateHistory ?? globalCfg.stateHistory ?? { enabled: true };
    if (stateHistoryCfg.enabled !== false) {
      const entry: StateHistoryEntry = {
        runId,
        startedAt,
        endedAt,
        durationMs,
        runNumber,
        status: r.status,
        halt: r.halt ?? null,
        error: r.error?.message ?? null,
        stepOutputs: r.stepOutputs,
        warnings: r.warnings,
        softErrors: r.softErrors,
      };
      appendHistory(name, entry, stateHistoryCfg);
    }

    // Write state — persist lastValues on success or halted (§4)
    const persistedLastValues =
      r.status === RUN_STATUS_OK || r.status === RUN_STATUS_HALTED
        ? r.lastValues
        : (prevState?.lastValues ?? {});

    const newState: PipelineState = {
      lastRun: endedAt,
      lastStatus: r.status,
      lastError: r.error?.message ?? null,
      runCount: runNumber,
      consecutiveFailures:
        r.status === RUN_STATUS_ERROR
          ? (prevState?.consecutiveFailures ?? 0) + 1
          : 0,
      lastValues: persistedLastValues,
    };
    await writeState(name, newState);

    // Clear journal unconditionally on completion (§6)
    await clearJournal(name);

    return {
      status: r.status,
      runId,
      ...(r.halt ? { halt: r.halt } : {}),
      ...(r.error ? { error: r.error } : {}),
    };
  } finally {
    await releaseLock(lock);
  }
}

// ── onError hook runner ─────────────────────────────────────────────

async function runOnErrorHook(
  hookStep: Step,
  pipelineName: string,
  runId: string,
  engine: ExprEngine,
  ctx: PipelineContext & Record<string, unknown>,
  failedStep: string,
  errorMessage: string,
): Promise<void> {
const hookDef = normaliseStep(hookStep, -1, "onError");

  const handler = lookup(hookDef.type);
  if (!handler) {
    logger.warn(`onError hook handler "${hookDef.type}" not found`);
    return;
  }

  // Build hook context with error info
  const hookCtx: PipelineContext & Record<string, unknown> = {
    ...ctx,
    __error: { step: failedStep, message: errorMessage },
    __failed: failedStep,
  };

  try {
    const resolvedInput = await resolveRuntime(
      hookDef.input,
      engine,
      buildExprContext(hookCtx),
    );

    appendEvent(pipelineName, { type: "step_start", runId, name: hookDef.name, startedAt: nowIso() });
    await executeStep(handler, hookCtx, resolvedInput);
    appendEvent(pipelineName, { type: "step_end", runId, name: hookDef.name, status: RUN_STATUS_OK, endedAt: nowIso() });
  } catch (err) {
    logger.error(`onError hook "${hookDef.name}" failed: ${err instanceof Error ? err.message : String(err)}`);
    appendEvent(pipelineName, { type: "step_end", runId, name: hookDef.name, status: RUN_STATUS_ERROR, endedAt: nowIso() });
  }
}

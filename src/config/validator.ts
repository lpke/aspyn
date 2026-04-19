import type { PipelineConfig, GlobalConfig, StepObject, Step, RetrySpec, StateHistoryConfig } from "../types/config.js";
import { HANDLER_TYPES, LOG_LEVELS, MISSED_RUN_POLICIES } from "../constants.js";
import { loadGlobalConfig, loadPipelineConfig, listPipelineNames } from "./loader.js";

// ── Result types ────────────────────────────────────────────────────

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string[];
}

export interface ValidationResult {
  pipeline: string;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

// ── Helpers ─────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const VALID_HANDLER_TYPES = new Set<string>(HANDLER_TYPES);
const VALID_BACKOFF = new Set(["fixed", "linear", "exponential"]);
const DURATION_RE = /^\d+(?:\.\d+)?(?:ms|s|m|h|d)$/;

// ── Validation implementation ───────────────────────────────────────

export function validatePipeline(
  cfg: PipelineConfig,
  globalCfg: GlobalConfig,
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const name = cfg.name ?? "(unnamed)";

  function err(code: string, message: string, path?: string[]): void {
    errors.push({ code, message, path });
  }
  function warn(code: string, message: string, path?: string[]): void {
    warnings.push({ code, message, path });
  }

  // ── pipeline array ────────────────────────────────────────────────

  if (!Array.isArray(cfg.pipeline)) {
    err("MISSING_PIPELINE", '"pipeline" must be an array', ["pipeline"]);
    return { pipeline: name, errors, warnings };
  }

  if (cfg.pipeline.length === 0) {
    err("EMPTY_PIPELINE", '"pipeline" must contain at least one step', ["pipeline"]);
  }

  // ── step names uniqueness ─────────────────────────────────────────

  const stepNames = new Set<string>();
  const objectSteps: { step: StepObject; index: number }[] = [];

  for (let i = 0; i < cfg.pipeline.length; i++) {
    const step = cfg.pipeline[i];
    if (typeof step === "string") {
      // shorthand step — no further validation needed beyond handler type
      // shorthand strings don't have a "type" to validate here (they're resolved at runtime)
      continue;
    }
    if (!isObject(step)) {
      err("INVALID_STEP", `Step at index ${i} must be a string or object`, ["pipeline", String(i)]);
      continue;
    }
    const s = step as StepObject;
    objectSteps.push({ step: s, index: i });

    // name — required
    if (typeof s.name !== "string" || s.name.length === 0) {
      err("MISSING_STEP_NAME", `Step at index ${i} must have a non-empty "name"`, ["pipeline", String(i), "name"]);
    } else {
      if (stepNames.has(s.name)) {
        err("DUPLICATE_STEP_NAME", `Duplicate step name "${s.name}"`, ["pipeline", String(i), "name"]);
      }
      stepNames.add(s.name);
    }

    // type — required, must be known
    if (typeof s.type !== "string" || s.type.length === 0) {
      err("MISSING_STEP_TYPE", `Step "${s.name ?? i}" must have a non-empty "type"`, ["pipeline", String(i), "type"]);
    } else if (!VALID_HANDLER_TYPES.has(s.type)) {
      err("UNKNOWN_HANDLER_TYPE", `Step "${s.name}" has unknown type "${s.type}". Valid types: ${HANDLER_TYPES.join(", ")}`, ["pipeline", String(i), "type"]);
    }

    // timeout
    if (s.timeout !== undefined) {
      if (typeof s.timeout === "string") {
        if (!DURATION_RE.test(s.timeout)) {
          err("INVALID_TIMEOUT", `Step "${s.name}" timeout must be a positive number or duration string`, ["pipeline", String(i), "timeout"]);
        }
      } else if (typeof s.timeout !== "number" || s.timeout <= 0) {
        err("INVALID_TIMEOUT", `Step "${s.name}" timeout must be a positive number or duration string`, ["pipeline", String(i), "timeout"]);
      }
    }

    // retry
    if (s.retry !== undefined) {
      validateRetrySpec(s.retry, ["pipeline", String(i), "retry"], s.name ?? String(i), err);
    }

    // when — must be string
    if (s.when !== undefined && typeof s.when !== "string") {
      err("INVALID_WHEN", `Step "${s.name}" "when" must be a string expression`, ["pipeline", String(i), "when"]);
    }

    // onError — inline Step (string or StepObject)
    if (s.onError !== undefined) {
      validateOnErrorHook(s.onError, ["pipeline", String(i), "onError"], `step "${s.name}"`, err);
    }

    // sideEffect — boolean
    if (s.sideEffect !== undefined && typeof s.sideEffect !== "boolean") {
      err("INVALID_SIDE_EFFECT", `Step "${s.name}" "sideEffect" must be a boolean`, ["pipeline", String(i), "sideEffect"]);
    }

    // track — boolean
    if (s.track !== undefined && typeof s.track !== "boolean") {
      err("INVALID_TRACK", `Step "${s.name}" "track" must be a boolean`, ["pipeline", String(i), "track"]);
    }

    // continueOnError — boolean
    if (s.continueOnError !== undefined && typeof s.continueOnError !== "boolean") {
      err("INVALID_CONTINUE_ON_ERROR", `Step "${s.name}" "continueOnError" must be a boolean`, ["pipeline", String(i), "continueOnError"]);
    }

    // description — string
    if (s.description !== undefined && typeof s.description !== "string") {
      warn("INVALID_DESCRIPTION", `Step "${s.name}" "description" should be a string`, ["pipeline", String(i), "description"]);
    }
  }

  // ── onError references ── (now inline Steps, no UNRESOLVED check needed)

  if (cfg.onError !== undefined) {
    validateOnErrorHook(cfg.onError, ["onError"], "pipeline-level", err);
  }

  // ── pipeline-level fields ─────────────────────────────────────────

  // interval
  if (cfg.interval !== undefined) {
    if (typeof cfg.interval !== "string" || !DURATION_RE.test(cfg.interval)) {
      err("INVALID_INTERVAL", `"interval" must be a duration string (e.g. "30s", "5m")`, ["interval"]);
    }
  }

  // timeout
  if (cfg.timeout !== undefined) {
    if (typeof cfg.timeout === "string") {
      if (!DURATION_RE.test(cfg.timeout)) {
        err("INVALID_TIMEOUT", `Pipeline-level "timeout" must be a positive number or duration string`, ["timeout"]);
      }
    } else if (typeof cfg.timeout !== "number" || cfg.timeout <= 0) {
      err("INVALID_TIMEOUT", `Pipeline-level "timeout" must be a positive number or duration string`, ["timeout"]);
    }
  }

  // retry
  if (cfg.retry !== undefined) {
    validateRetrySpec(cfg.retry, ["retry"], "pipeline", err);
  }

  // log
  if (cfg.log !== undefined) {
    if (typeof cfg.log !== "string" || !(LOG_LEVELS as readonly string[]).includes(cfg.log)) {
      err("INVALID_LOG_LEVEL", `"log" must be one of: ${LOG_LEVELS.join(", ")}`, ["log"]);
    }
  }

  // proceedOnError
  if (cfg.proceedOnError !== undefined && typeof cfg.proceedOnError !== "boolean") {
    err("INVALID_PROCEED_ON_ERROR", `"proceedOnError" must be a boolean`, ["proceedOnError"]);
  }

  // stateHistory
  if (cfg.stateHistory !== undefined) {
    validateStateHistory(cfg.stateHistory, ["stateHistory"], err);
  }

  // name
  if (cfg.name !== undefined && typeof cfg.name !== "string") {
    err("INVALID_NAME", `"name" must be a string`, ["name"]);
  }

  // description
  if (cfg.description !== undefined && typeof cfg.description !== "string") {
    warn("INVALID_DESCRIPTION", `"description" should be a string`, ["description"]);
  }

  // ── Lint warnings ─────────────────────────────────────────────────

  // No interval set and no global default — warn
  if (cfg.interval === undefined) {
    warn("NO_INTERVAL", "No interval set; will use global defaultInterval", ["interval"]);
  }

  // Pipeline has only side-effect-free steps — warn
  const allStepsArePure = objectSteps.length > 0 && objectSteps.every(({ step }) => step.sideEffect === false);
  if (allStepsArePure) {
    warn("ALL_PURE_STEPS", "All steps have sideEffect=false; pipeline may have no observable effect");
  }

  // Steps without "track" on side-effect steps
  for (const { step, index } of objectSteps) {
    if (step.sideEffect === true && step.track === undefined) {
      warn("UNTRACKED_SIDE_EFFECT", `Step "${step.name}" is a side-effect but has no "track" setting`, ["pipeline", String(index), "track"]);
    }
  }

  return { pipeline: name, errors, warnings };
}

// ── Retry validation helper ─────────────────────────────────────────

function validateRetrySpec(
  retry: unknown,
  path: string[],
  context: string,
  err: (code: string, message: string, path?: string[]) => void,
): void {
  if (!isObject(retry)) {
    err("INVALID_RETRY", `"retry" in ${context} must be an object`, path);
    return;
  }
  const r = retry as Record<string, unknown>;
  if (typeof r.attempts !== "number" || r.attempts < 1) {
    err("INVALID_RETRY_ATTEMPTS", `"retry.attempts" in ${context} must be a positive integer`, [...path, "attempts"]);
  }
  if (typeof r.backoff !== "string" || !VALID_BACKOFF.has(r.backoff)) {
    err("INVALID_RETRY_BACKOFF", `"retry.backoff" in ${context} must be one of: ${[...VALID_BACKOFF].join(", ")}`, [...path, "backoff"]);
  }
  if (typeof r.initialDelay !== "number" || r.initialDelay < 0) {
    err("INVALID_RETRY_DELAY", `"retry.initialDelay" in ${context} must be a non-negative number`, [...path, "initialDelay"]);
  }
}

// ── StateHistory validation helper ──────────────────────────────────

function validateStateHistory(
  sh: unknown,
  path: string[],
  err: (code: string, message: string, path?: string[]) => void,
): void {
  if (!isObject(sh)) {
    err("INVALID_STATE_HISTORY", `"stateHistory" must be an object`, path);
    return;
  }
  const s = sh as Record<string, unknown>;
  if (s.enabled !== undefined && typeof s.enabled !== "boolean") {
    err("INVALID_STATE_HISTORY_ENABLED", `"stateHistory.enabled" must be a boolean`, [...path, "enabled"]);
  }
  if (s.maxFileSize !== undefined && typeof s.maxFileSize !== "string") {
    err("INVALID_STATE_HISTORY_MAX_SIZE", `"stateHistory.maxFileSize" must be a string`, [...path, "maxFileSize"]);
  }
  if (s.maxFiles !== undefined) {
    if (typeof s.maxFiles !== "number" || s.maxFiles < 1) {
      err("INVALID_STATE_HISTORY_MAX_FILES", `"stateHistory.maxFiles" must be a positive number`, [...path, "maxFiles"]);
    }
  }
}

// ── onError hook validation helper ───────────────────────────────────

function validateOnErrorHook(
  hook: Step,
  path: string[],
  context: string,
  err: (code: string, message: string, path?: string[]) => void,
): void {
  if (typeof hook === "string") {
    // String shorthand — treated as shell command, accept without further validation
    return;
  }
  if (!isObject(hook)) {
    err("INVALID_ON_ERROR", `"onError" in ${context} must be a string or step object`, path);
    return;
  }
  const s = hook as StepObject;
  if (typeof s.name !== "string" || s.name.length === 0) {
    err("MISSING_STEP_NAME", `"onError" in ${context} must have a non-empty "name"`, [...path, "name"]);
  }
  if (typeof s.type !== "string" || s.type.length === 0) {
    err("MISSING_STEP_TYPE", `"onError" in ${context} must have a non-empty "type"`, [...path, "type"]);
  } else if (!VALID_HANDLER_TYPES.has(s.type)) {
    err("UNKNOWN_HANDLER_TYPE", `"onError" in ${context} has unknown type "${s.type}"`, [...path, "type"]);
  }
}

// ── Validate all pipelines ──────────────────────────────────────────

export async function validateAll(): Promise<ValidationResult[]> {
  const globalCfg = await loadGlobalConfig();
  const names = await listPipelineNames();
  const results: ValidationResult[] = [];

  for (const name of names) {
    try {
      const cfg = await loadPipelineConfig(name);
      const r = validatePipeline(cfg, globalCfg);
      r.pipeline = name;
      results.push(r);
    } catch (e: unknown) {
      results.push({
        pipeline: name,
        errors: [{ code: "LOAD_ERROR", message: (e as Error).message }],
        warnings: [],
      });
    }
  }

  return results;
}

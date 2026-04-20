import type {
  PipelineConfig,
  GlobalConfig,
  StepObject,
  Step,
  RetrySpec,
  StateHistoryConfig,
} from '../types/config.js';
import {
  HANDLER_TYPES,
  LOG_LEVELS,
  MISSED_RUN_POLICIES,
  DEFAULT_TIMEOUT_SECONDS,
} from '../constants.js';
import {
  loadGlobalConfig,
  loadPipelineConfig,
  listPipelineNames,
} from './loader.js';
import { parseDurationMs } from '../duration.js';
import { HANDLER_REQUIRED_INPUT } from './handlerInputSchema.js';

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
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const VALID_HANDLER_TYPES = new Set<string>(HANDLER_TYPES);
const VALID_BACKOFF = new Set(['fixed', 'linear', 'exponential']);
const DURATION_RE = /^\d+(?:\.\d+)?(?:ms|s|m|h|d)$/;
const TEMPLATE_RE = /\$\{([^}]*)\}/g;
const IDENT_CHAIN_RE = /\b(steps|prev|changed)\.([A-Za-z_][\w-]*)/g;
const DOTTED_NUMERIC_RE = /\b(steps|prev|changed)\.([0-9]\w*)/g;
const RESERVED_ROOTS = new Set(['input', 'firstRun', 'meta', 'anyChanged']);

// ── Validation implementation ───────────────────────────────────────

export function validatePipeline(
  cfg: PipelineConfig,
  globalCfg: GlobalConfig,
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const name = cfg.name ?? '(unnamed)';

  function err(code: string, message: string, path?: string[]): void {
    errors.push({ code, message, path });
  }
  function warn(code: string, message: string, path?: string[]): void {
    warnings.push({ code, message, path });
  }

  // ── pipeline array ────────────────────────────────────────────────

  if (!Array.isArray(cfg.pipeline)) {
    err('MISSING_PIPELINE', '"pipeline" must be an array', ['pipeline']);
    return { pipeline: name, errors, warnings };
  }

  if (cfg.pipeline.length === 0) {
    err('EMPTY_PIPELINE', '"pipeline" must contain at least one step', [
      'pipeline',
    ]);
  }

  // ── step names uniqueness ─────────────────────────────────────────

  const stepNames = new Set<string>();
  const objectSteps: { step: StepObject; index: number }[] = [];

  for (let i = 0; i < cfg.pipeline.length; i++) {
    const step = cfg.pipeline[i];
    if (typeof step === 'string') {
      // Auto-name bare-string steps as step-<index>
      const autoName = `step-${i}`;
      stepNames.add(autoName);
      objectSteps.push({
        step: { name: autoName, type: 'shell', input: step } as StepObject,
        index: i,
      });
      continue;
    }
    if (!isObject(step)) {
      err('INVALID_STEP', `Step at index ${i} must be a string or object`, [
        'pipeline',
        String(i),
      ]);
      continue;
    }
    let s = step as StepObject;
    objectSteps.push({ step: s, index: i });

    // name — auto-assign if missing
    if (typeof s.name !== 'string' || s.name.length === 0) {
      s = { ...s, name: `step-${i}` } as StepObject;
      objectSteps[objectSteps.length - 1] = { step: s, index: i };
    }
    {
      if (stepNames.has(s.name)) {
        err('DUPLICATE_STEP_NAME', `Duplicate step name "${s.name}"`, [
          'pipeline',
          String(i),
          'name',
        ]);
      }
      stepNames.add(s.name);
    }

    // type — required, must be known
    if (typeof s.type !== 'string' || s.type.length === 0) {
      err(
        'MISSING_STEP_TYPE',
        `Step "${s.name ?? i}" must have a non-empty "type"`,
        ['pipeline', String(i), 'type'],
      );
    } else if (!VALID_HANDLER_TYPES.has(s.type)) {
      err(
        'UNKNOWN_HANDLER_TYPE',
        `Step "${s.name}" has unknown type "${s.type}". Valid types: ${HANDLER_TYPES.join(', ')}`,
        ['pipeline', String(i), 'type'],
      );
    }

    // timeout
    if (s.timeout !== undefined) {
      if (typeof s.timeout === 'string') {
        if (!DURATION_RE.test(s.timeout)) {
          err(
            'INVALID_TIMEOUT',
            `Step "${s.name}" timeout must be a positive number or duration string`,
            ['pipeline', String(i), 'timeout'],
          );
        }
      } else if (typeof s.timeout !== 'number' || s.timeout <= 0) {
        err(
          'INVALID_TIMEOUT',
          `Step "${s.name}" timeout must be a positive number or duration string`,
          ['pipeline', String(i), 'timeout'],
        );
      }
    }

    // retry
    if (s.retry !== undefined) {
      validateRetrySpec(
        s.retry,
        ['pipeline', String(i), 'retry'],
        s.name ?? String(i),
        err,
      );
    }

    // when — must be string
    if (s.when !== undefined && typeof s.when !== 'string') {
      err(
        'INVALID_WHEN',
        `Step "${s.name}" "when" must be a string expression`,
        ['pipeline', String(i), 'when'],
      );
    }

    // onError — inline Step (string or StepObject)
    if (s.onError !== undefined) {
      validateOnErrorHook(
        s.onError,
        ['pipeline', String(i), 'onError'],
        `step "${s.name}"`,
        err,
      );
    }

    // sideEffect — boolean
    if (s.sideEffect !== undefined && typeof s.sideEffect !== 'boolean') {
      err(
        'INVALID_SIDE_EFFECT',
        `Step "${s.name}" "sideEffect" must be a boolean`,
        ['pipeline', String(i), 'sideEffect'],
      );
    }

    // track — boolean
    if (s.track !== undefined && typeof s.track !== 'boolean') {
      err('INVALID_TRACK', `Step "${s.name}" "track" must be a boolean`, [
        'pipeline',
        String(i),
        'track',
      ]);
    }

    // continueOnError — boolean
    if (
      s.continueOnError !== undefined &&
      typeof s.continueOnError !== 'boolean'
    ) {
      err(
        'INVALID_CONTINUE_ON_ERROR',
        `Step "${s.name}" "continueOnError" must be a boolean`,
        ['pipeline', String(i), 'continueOnError'],
      );
    }

    // description — string
    if (s.description !== undefined && typeof s.description !== 'string') {
      warn(
        'INVALID_DESCRIPTION',
        `Step "${s.name}" "description" should be a string`,
        ['pipeline', String(i), 'description'],
      );
    }
  }

  // ── onError references ── (now inline Steps, no UNRESOLVED check needed)

  if (cfg.onError !== undefined) {
    validateOnErrorHook(cfg.onError, ['onError'], 'pipeline-level', err);
  }

  // ── pipeline-level fields ─────────────────────────────────────────

  // interval
  if (cfg.interval !== undefined) {
    if (typeof cfg.interval !== 'string' || !DURATION_RE.test(cfg.interval)) {
      err(
        'INVALID_INTERVAL',
        `"interval" must be a duration string (e.g. "30s", "5m")`,
        ['interval'],
      );
    }
  }

  // timeout
  if (cfg.timeout !== undefined) {
    if (typeof cfg.timeout === 'string') {
      if (!DURATION_RE.test(cfg.timeout)) {
        err(
          'INVALID_TIMEOUT',
          `Pipeline-level "timeout" must be a positive number or duration string`,
          ['timeout'],
        );
      }
    } else if (typeof cfg.timeout !== 'number' || cfg.timeout <= 0) {
      err(
        'INVALID_TIMEOUT',
        `Pipeline-level "timeout" must be a positive number or duration string`,
        ['timeout'],
      );
    }
  }

  // retry
  if (cfg.retry !== undefined) {
    validateRetrySpec(cfg.retry, ['retry'], 'pipeline', err);
  }

  // log
  if (cfg.log !== undefined) {
    if (
      typeof cfg.log !== 'string' ||
      !(LOG_LEVELS as readonly string[]).includes(cfg.log)
    ) {
      err(
        'INVALID_LOG_LEVEL',
        `"log" must be one of: ${LOG_LEVELS.join(', ')}`,
        ['log'],
      );
    }
  }

  // proceedOnError
  if (
    cfg.proceedOnError !== undefined &&
    typeof cfg.proceedOnError !== 'boolean'
  ) {
    err('INVALID_PROCEED_ON_ERROR', `"proceedOnError" must be a boolean`, [
      'proceedOnError',
    ]);
  }

  // stateHistory
  if (cfg.stateHistory !== undefined) {
    validateStateHistory(cfg.stateHistory, ['stateHistory'], err);
  }

  // name
  if (cfg.name !== undefined && typeof cfg.name !== 'string') {
    err('INVALID_NAME', `"name" must be a string`, ['name']);
  }

  // description
  if (cfg.description !== undefined && typeof cfg.description !== 'string') {
    warn('INVALID_DESCRIPTION', `"description" should be a string`, [
      'description',
    ]);
  }

  // ── Lint warnings ─────────────────────────────────────────────────

  // No interval set and no global default — warn
  if (cfg.interval === undefined) {
    warn('NO_INTERVAL', 'No interval set; will use global defaultInterval', [
      'interval',
    ]);
  }

  // Pipeline has only side-effect-free steps — warn
  const allStepsArePure =
    objectSteps.length > 0 &&
    objectSteps.every(({ step }) => step.sideEffect === false);
  if (allStepsArePure) {
    warn(
      'ALL_PURE_STEPS',
      'All steps have sideEffect=false; pipeline may have no observable effect',
    );
  }

  // Steps without "track" on side-effect steps — removed (track defaults intelligently now)

  // Pipeline retry unreachable
  if (
    cfg.retry &&
    ((objectSteps.length > 0 &&
      objectSteps.every(({ step }) => step.continueOnError === true)) ||
      cfg.proceedOnError === true)
  ) {
    warn(
      'PIPELINE_RETRY_UNREACHABLE',
      'pipeline.retry is set but every step is covered by continueOnError/proceedOnError; pipeline retry will never trigger',
      ['retry'],
    );
  }

  // ── §14.2 lint warnings ──────────────────────────────────────────

  // 2a. SIDE_EFFECT_TRACK
  for (const { step, index: idx } of objectSteps) {
    if (step.sideEffect === true && step.track === true) {
      warn(
        'SIDE_EFFECT_TRACK',
        `step "${step.name}" sets sideEffect: true and track: true; side-effect steps are rarely meaningful to change-track`,
        ['pipeline', String(idx)],
      );
    }
  }

  // 2b. NESTED_RETRY
  if (cfg.retry && (cfg.retry as RetrySpec).attempts > 1) {
    const offenders = objectSteps
      .filter(({ step }) => step.retry && step.retry.attempts > 1)
      .map(({ step }) => step.name);
    if (offenders.length > 0) {
      warn(
        'NESTED_RETRY',
        `pipeline.retry and step.retry are both enabled; failures in [${offenders.join(', ')}] retry per-step AND per-pipeline, multiplying attempts`,
        ['retry'],
      );
    }
  }

  // 2c. INTERVAL_TOO_SHORT
  try {
    const intervalMs = cfg.interval ? parseDurationMs(cfg.interval) : null;
    if (intervalMs != null) {
      let sumMs = 0;
      for (const { step } of objectSteps) {
        const perStep =
          step.timeout !== undefined
            ? parseDurationMs(step.timeout)
            : DEFAULT_TIMEOUT_SECONDS * 1000;
        const attempts = step.retry?.attempts ?? 1;
        sumMs += perStep * attempts;
      }
      const pipelineMs =
        cfg.timeout !== undefined ? parseDurationMs(cfg.timeout) : sumMs;
      const worstCase = Math.min(sumMs, pipelineMs);
      if (worstCase > intervalMs) {
        warn(
          'INTERVAL_TOO_SHORT',
          `interval (${intervalMs}ms) may be shorter than worst-case run duration (~${worstCase}ms); runs may overlap or be skipped by missedRunPolicy`,
          ['interval'],
        );
      }
    }
  } catch {
    // skip warning if duration parsing fails — reported elsewhere
  }

  // 2d. SHELL_INJECTION_RISK
  for (const { step, index: idx } of objectSteps) {
    if (step.type !== 'shell') continue;
    const command =
      typeof step.input === 'string'
        ? step.input
        : (step.input as { command?: unknown } | undefined)?.command;
    if (typeof command !== 'string') continue;

    let hasRisk = false;
    let pos = 0;
    while ((pos = command.indexOf('${', pos)) !== -1) {
      // Walk backwards skipping whitespace
      let j = pos - 1;
      while (j >= 0 && (command[j] === ' ' || command[j] === '\t')) j--;
      if (j < 0 || command[j] !== "'") {
        hasRisk = true;
        break;
      }
      pos += 2;
    }
    if (hasRisk) {
      warn(
        'SHELL_INJECTION_RISK',
        `step "${step.name}" shell command interpolates \${...} without single-quote wrapping; consider quoting to avoid shell-injection on user-influenced inputs`,
        ['pipeline', String(idx), 'input'],
      );
    }
  }

  // TODO: 2e. ORPHAN_COLOCATED_SCRIPT — deferred to Phase 18 (spec §14.2)
  // Requires CLI filesystem utilities that land in Phase 18.

  // ── §14.1 hard errors (reference-level) ──────────────────────────
  // Only run if no structural errors — otherwise noise multiplies.

  if (errors.length === 0) {
    const stepByName = new Map<string, { step: StepObject; index: number }>();
    for (let i = 0; i < objectSteps.length; i++) {
      const { step } = objectSteps[i];
      if (step.name) stepByName.set(step.name, { step, index: i });
    }

    function validateRef(opts: {
      cur: StepObject;
      curIndex: number;
      namespace: string;
      refName: string;
    }): void {
      const { cur, curIndex, namespace, refName } = opts;
      if (!stepByName.has(refName)) {
        err(
          'UNKNOWN_STEP_REFERENCE',
          `step "${cur.name}" references ${namespace}.${refName} which does not exist`,
          ['pipeline', String(curIndex)],
        );
        return;
      }
      const target = stepByName.get(refName)!;
      if (target.index === curIndex && namespace === 'steps') {
        err(
          'SELF_REFERENCE',
          `step "${cur.name}" references steps.${cur.name} (its own output is not available at evaluation time)`,
          ['pipeline', String(curIndex)],
        );
        return;
      }
      if (target.index > curIndex) {
        err(
          'FORWARD_REFERENCE',
          `step "${cur.name}" references ${namespace}.${refName} which is defined later (index ${target.index} vs current ${curIndex})`,
          ['pipeline', String(curIndex)],
        );
        return;
      }
      if (
        (namespace === 'changed' || namespace === 'prev') &&
        target.step.track === false
      ) {
        err(
          'UNTRACKED_REFERENCE',
          `step "${cur.name}" uses ${namespace}.${refName} but step "${refName}" has track: false`,
          ['pipeline', String(curIndex)],
        );
      }
    }

    function forEachString(v: unknown, visit: (s: string) => void): void {
      if (typeof v === 'string') {
        visit(v);
        return;
      }
      if (Array.isArray(v)) {
        for (const x of v) forEachString(x, visit);
        return;
      }
      if (v !== null && typeof v === 'object') {
        for (const x of Object.values(v as Record<string, unknown>))
          forEachString(x, visit);
      }
    }

    for (let i = 0; i < objectSteps.length; i++) {
      const { step } = objectSteps[i];

      // Reference scanning
      const scanTargets: unknown[] = [
        step.input,
        step.when,
        step.timeout,
        step.retry,
        step.onError,
      ];
      for (const target of scanTargets) {
        forEachString(target, (s) => {
          let tm: RegExpExecArray | null;

          // Reject dotted-numeric references like ${steps.0}
          TEMPLATE_RE.lastIndex = 0;
          while ((tm = TEMPLATE_RE.exec(s))) {
            const body = tm[1];
            let dnm: RegExpExecArray | null;
            DOTTED_NUMERIC_RE.lastIndex = 0;
            while ((dnm = DOTTED_NUMERIC_RE.exec(body))) {
              err(
                'DOTTED_NUMERIC_REFERENCE',
                `step "${step.name}" uses ${dnm[1]}.${dnm[2]} (dotted numeric); use bracket notation ${dnm[1]}[${dnm[2]}] or the auto-assigned name "step-${dnm[2]}" instead`,
                ['pipeline', String(i)],
              );
            }
          }

          TEMPLATE_RE.lastIndex = 0;
          while ((tm = TEMPLATE_RE.exec(s))) {
            const body = tm[1];
            let rm: RegExpExecArray | null;
            IDENT_CHAIN_RE.lastIndex = 0;
            while ((rm = IDENT_CHAIN_RE.exec(body))) {
              const namespace = rm[1] as 'steps' | 'prev' | 'changed';
              const refName = rm[2];
              if (RESERVED_ROOTS.has(refName)) continue;
              validateRef({ cur: step, curIndex: i, namespace, refName });
            }
          }
        });
      }

      // 1e. MISSING_REQUIRED_INPUT / REQUIRES_OBJECT_INPUT
      if (step.type && HANDLER_REQUIRED_INPUT[step.type]) {
        const schema = HANDLER_REQUIRED_INPUT[step.type];
        if (typeof step.input === 'string') {
          if (!schema.stringShorthand) {
            err(
              'REQUIRES_OBJECT_INPUT',
              `step "${step.name}" (type "${step.type}") does not accept string-shorthand input; use an object`,
              ['pipeline', String(i), 'input'],
            );
          }
        } else {
          const inputObj = (step.input ?? {}) as Record<string, unknown>;
          for (const field of schema.fields) {
            if (!(field in inputObj)) {
              err(
                'MISSING_REQUIRED_INPUT',
                `step "${step.name}" (type "${step.type}") missing required input field "${field}"`,
                ['pipeline', String(i), 'input', field],
              );
            }
          }
        }
      }
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
    err('INVALID_RETRY', `"retry" in ${context} must be an object`, path);
    return;
  }
  const r = retry as Record<string, unknown>;
  if (typeof r.attempts !== 'number' || r.attempts < 1) {
    err(
      'INVALID_RETRY_ATTEMPTS',
      `"retry.attempts" in ${context} must be a positive integer`,
      [...path, 'attempts'],
    );
  }
  if (typeof r.backoff !== 'string' || !VALID_BACKOFF.has(r.backoff)) {
    err(
      'INVALID_RETRY_BACKOFF',
      `"retry.backoff" in ${context} must be one of: ${[...VALID_BACKOFF].join(', ')}`,
      [...path, 'backoff'],
    );
  }
  if (typeof r.initialDelay === 'number') {
    if (!Number.isFinite(r.initialDelay) || r.initialDelay < 0) {
      err(
        'INVALID_INITIAL_DELAY',
        `"retry.initialDelay" in ${context} must be a finite, non-negative number of seconds`,
        [...path, 'initialDelay'],
      );
    }
  } else if (typeof r.initialDelay === 'string') {
    try {
      parseDurationMs(r.initialDelay);
    } catch {
      err(
        'INVALID_INITIAL_DELAY',
        `"retry.initialDelay" in ${context}: invalid duration "${r.initialDelay}"`,
        [...path, 'initialDelay'],
      );
    }
  } else {
    err(
      'INVALID_INITIAL_DELAY',
      `"retry.initialDelay" in ${context} must be a number (seconds) or duration string`,
      [...path, 'initialDelay'],
    );
  }
}

// ── StateHistory validation helper ──────────────────────────────────

function validateStateHistory(
  sh: unknown,
  path: string[],
  err: (code: string, message: string, path?: string[]) => void,
): void {
  if (!isObject(sh)) {
    err('INVALID_STATE_HISTORY', `"stateHistory" must be an object`, path);
    return;
  }
  const s = sh as Record<string, unknown>;
  if (s.enabled !== undefined && typeof s.enabled !== 'boolean') {
    err(
      'INVALID_STATE_HISTORY_ENABLED',
      `"stateHistory.enabled" must be a boolean`,
      [...path, 'enabled'],
    );
  }
  if (s.maxFileSize !== undefined && typeof s.maxFileSize !== 'string') {
    err(
      'INVALID_STATE_HISTORY_MAX_SIZE',
      `"stateHistory.maxFileSize" must be a string`,
      [...path, 'maxFileSize'],
    );
  } else if (
    typeof s.maxFileSize === 'string' &&
    !/^\d+(?:\.\d+)?(b|kb|mb|gb)$/i.test(s.maxFileSize)
  ) {
    err(
      'INVALID_STATE_HISTORY_MAX_SIZE',
      `"stateHistory.maxFileSize" must match format like "5mb", "1gb"`,
      [...path, 'maxFileSize'],
    );
  }
  if (s.maxFiles !== undefined) {
    if (typeof s.maxFiles !== 'number' || s.maxFiles < 1) {
      err(
        'INVALID_STATE_HISTORY_MAX_FILES',
        `"stateHistory.maxFiles" must be a positive number`,
        [...path, 'maxFiles'],
      );
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
  if (!isObject(hook)) {
    err(
      'INVALID_ON_ERROR',
      `"onError" in ${context} must be a step object`,
      path,
    );
    return;
  }
  const s = hook as StepObject;
  if (typeof s.name !== 'string' || s.name.length === 0) {
    err(
      'MISSING_STEP_NAME',
      `"onError" in ${context} must have a non-empty "name"`,
      [...path, 'name'],
    );
  }
  if (typeof s.type !== 'string' || s.type.length === 0) {
    err(
      'MISSING_STEP_TYPE',
      `"onError" in ${context} must have a non-empty "type"`,
      [...path, 'type'],
    );
  } else if (!VALID_HANDLER_TYPES.has(s.type)) {
    err(
      'UNKNOWN_HANDLER_TYPE',
      `"onError" in ${context} has unknown type "${s.type}"`,
      [...path, 'type'],
    );
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
        errors: [{ code: 'LOAD_ERROR', message: (e as Error).message }],
        warnings: [],
      });
    }
  }

  return results;
}

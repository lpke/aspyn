#!/usr/bin/env node

import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';

import {
  APP_NAME,
  EXIT_SUCCESS,
  EXIT_STEP_ERROR,
  EXIT_ASPYN_ERROR,
  EXIT_LOCK_HELD,
  EXIT_USAGE,
  CANONICAL_STEP_NAMES,
  CONFIG_FILE,
  RUN_STATUS_OK,
  RUN_STATUS_INTERRUPTED,
} from './constants.js';
import { logger } from './logger.js';
import { output } from './output.js';
import {
  configRoot,
  pipelineConfigDir,
  pipelineConfigPath,
  runLogPath,
  actionLogPath,
  stateJsonPath,
  stateHistoryPath,
} from './paths.js';
import {
  loadPipelineConfig,
  loadGlobalConfig,
  listPipelineNames,
} from './config/loader.js';
import { validateAll } from './config/validator.js';
import { runPipeline } from './pipeline/engine.js';
import { readState, clearState } from './state/state.js';
import { readHistory, clearHistory } from './state/history.js';
import { startDaemon } from './daemon.js';
import type { RunOptions } from './types/pipeline.js';
import type { PipelineState } from './types/state.js';

// ── Arg parser ──────────────────────────────────────────────────────

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | true>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i += 1;
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }
  return { positional, flags };
}

function flag(args: ParsedArgs, name: string): string | true | undefined {
  return args.flags[name];
}

function flagStr(args: ParsedArgs, name: string): string | undefined {
  const v = args.flags[name];
  return typeof v === 'string' ? v : undefined;
}

function flagBool(args: ParsedArgs, name: string): boolean {
  return args.flags[name] !== undefined;
}

// ── Usage ───────────────────────────────────────────────────────────

const USAGE = `Usage: aspyn <command> [options]

Commands:
  aspyn run <name> [--verbose] [--dry] [--until <s>] [--from <s>] [--continue] [--reset] [--replay-side-effects]
  aspyn run --all
  aspyn daemon [--verbose]
  aspyn list
  aspyn state list
  aspyn state show <name> [--step <s>]
  aspyn state history <name> [--step <s>] [--since <d>] [--until <d>] [--status <s>] [--limit <n>] [--offset <n>] [--format json|table|tsv]
  aspyn state diff <name>
  aspyn state clear <name> [--step <s>] [--wipe-history]
  aspyn log <name> [--action | --state]
  aspyn validate [--format json]
  aspyn init <name>
`;

// ── Commands ────────────────────────────────────────────────────────

async function cmdRun(args: ParsedArgs): Promise<number> {
  const all = flagBool(args, 'all');

  if (!all && args.positional.length < 1) {
    output.printHelp('Usage: aspyn run <name> [options] or aspyn run --all');
    return EXIT_USAGE;
  }

  const names = all ? await listPipelineNames() : [args.positional[0]];
  const verbose = flagBool(args, 'verbose');
  const dry = flagBool(args, 'dry');
  const until = flagStr(args, 'until');
  const from = flagStr(args, 'from');
  const cont = flagBool(args, 'continue');
  const reset = flagBool(args, 'reset');
  const replaySideEffects = flagBool(args, 'replay-side-effects');

  // Coerce numeric --from/--until strings to numbers
  const coerceIndex = (s: string | undefined): string | number | undefined => {
    if (s === undefined) return undefined;
    const n = parseInt(s, 10);
    if (!isNaN(n) && n >= 0 && String(n) === s) return n;
    return s;
  };

  const resolvedFrom = coerceIndex(from);
  const resolvedUntil = coerceIndex(until);

  let anyError = false;
  let anyLockHeld = false;

  for (const name of names) {
    const opts: RunOptions = {
      verbose,
      dry,
      ...(resolvedUntil !== undefined && { until: resolvedUntil }),
      ...(resolvedFrom !== undefined && { from: resolvedFrom }),
      ...(cont && { continueFromCrash: true }),
      ...(reset && { resetCrash: true }),
      ...(replaySideEffects && { replaySideEffects: true }),
    };

    try {
      const result = await runPipeline(name, opts);
      if (result.status === RUN_STATUS_INTERRUPTED) {
        logger.warn(`${name}: lock held, skipping`);
        anyLockHeld = true;
      } else if (
        result.status !== RUN_STATUS_OK &&
        result.status !== 'halted' &&
        result.status !== 'skipped'
      ) {
        anyError = true;
      }
    } catch (err) {
      logger.error(
        `${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
      anyError = true;
    }
  }

  if (anyError) return EXIT_STEP_ERROR;
  if (anyLockHeld) return EXIT_LOCK_HELD;
  return EXIT_SUCCESS;
}

async function cmdDaemon(args: ParsedArgs): Promise<number> {
  const verbose = flagBool(args, 'verbose');
  await startDaemon({ verbose });
  return EXIT_SUCCESS;
}

async function cmdList(): Promise<number> {
  const names = await listPipelineNames();
  if (names.length === 0) {
    output.printHelp('No pipelines found.');
    return EXIT_SUCCESS;
  }

  const rows = [];
  for (const name of names) {
    let interval = '-';
    let lastRun = 'never';
    let status = '-';
    const nextRun = '-';

    try {
      const cfg = await loadPipelineConfig(name);
      interval = cfg.interval ?? '-';
    } catch {
      /* skip */
    }

    try {
      const state = await readState(name);
      if (state?.lastRun) {
        lastRun = state.lastRun;
        status = state.lastStatus ?? '-';
      }
    } catch {
      /* skip */
    }

    rows.push({ name, interval, lastRun, status, nextRun });
  }

  output.printListTable(rows);
  return EXIT_SUCCESS;
}

async function cmdStateList(): Promise<number> {
  const names = await listPipelineNames();
  for (const name of names) {
    const state = await readState(name);
    const status = state?.lastStatus ?? 'no state';
    const runs = state?.runCount ?? 0;
    output.printHelp(`${chalk.bold(name)}  status=${status}  runs=${runs}`);
  }
  return EXIT_SUCCESS;
}

async function cmdStateShow(args: ParsedArgs): Promise<number> {
  const name = args.positional[0];
  if (!name) {
    output.printHelp('Usage: aspyn state show <name> [--step <s>]');
    return EXIT_USAGE;
  }

  const state = await readState(name);
  if (!state) {
    output.printHelp(`No state for pipeline "${name}".`);
    return EXIT_SUCCESS;
  }

  const stepArg = flagStr(args, 'step');
  if (stepArg !== undefined) {
    // Accept name or 0-based index
    const keys = Object.keys(state.lastValues);
    const idx = parseInt(stepArg, 10);
    const stepName =
      !isNaN(idx) && idx >= 0 && idx < keys.length ? keys[idx] : stepArg;
    const val = state.lastValues[stepName];
    if (val === undefined) {
      output.printHelp(`No output for step "${stepName}".`);
    } else {
      output.printHelp(JSON.stringify(val, null, 2));
    }
    return EXIT_SUCCESS;
  }

  output.printHelp(JSON.stringify(state, null, 2));
  return EXIT_SUCCESS;
}

async function cmdStateHistory(args: ParsedArgs): Promise<number> {
  const name = args.positional[0];
  if (!name) {
    output.printHelp('Usage: aspyn state history <name> [options]');
    return EXIT_USAGE;
  }

  const stepFilter = flagStr(args, 'step');
  const since = flagStr(args, 'since');
  const until = flagStr(args, 'until');
  const statusFilter = flagStr(args, 'status');
  const limit = flagStr(args, 'limit');
  const offset = flagStr(args, 'offset');
  const format = (flagStr(args, 'format') ?? 'table') as
    | 'table'
    | 'json'
    | 'tsv';

  const entries = await readHistory(name, {
    sinceIso: since,
    untilIso: until,
    statusFilter,
    limit: limit !== undefined ? parseInt(limit, 10) : undefined,
    offset: offset !== undefined ? parseInt(offset, 10) : undefined,
  });

  // If --step is given, narrow stepOutputs to that step
  const filtered = stepFilter
    ? entries.map((e) => ({
        ...e,
        stepOutputs:
          e.stepOutputs[stepFilter] !== undefined
            ? { [stepFilter]: e.stepOutputs[stepFilter] }
            : {},
      }))
    : entries;

  output.printStateHistory(filtered, format);
  return EXIT_SUCCESS;
}

async function cmdStateDiff(args: ParsedArgs): Promise<number> {
  const name = args.positional[0];
  if (!name) {
    output.printHelp('Usage: aspyn state diff <name>');
    return EXIT_USAGE;
  }

  const entries = await readHistory(name, { limit: 2 });

  if (entries.length < 2) {
    output.printHelp(
      'Not enough history entries for diff (need at least 2 runs).',
    );
    return EXIT_SUCCESS;
  }

  const current = entries[0].stepOutputs;
  const previous = entries[1].stepOutputs;

  output.printHelp(chalk.bold('Current:'));
  output.printHelp(JSON.stringify(current, null, 2));
  output.sectionGap();
  output.printHelp(chalk.bold('Previous run:'));
  output.printHelp(JSON.stringify(previous, null, 2));
  return EXIT_SUCCESS;
}

async function cmdStateClear(args: ParsedArgs): Promise<number> {
  const name = args.positional[0];
  if (!name) {
    output.printHelp(
      'Usage: aspyn state clear <name> [--step <s>] [--wipe-history]',
    );
    return EXIT_USAGE;
  }

  const step = flagStr(args, 'step');
  const wipeHistory = flagBool(args, 'wipe-history');

  await clearState(name, step);
  if (wipeHistory) {
    await clearHistory(name);
  }

  logger.info(
    `State cleared for "${name}"${step ? ` (step: ${step})` : ''}${wipeHistory ? ' (history wiped)' : ''}`,
  );
  return EXIT_SUCCESS;
}

async function cmdLog(args: ParsedArgs): Promise<number> {
  const name = args.positional[0];
  if (!name) {
    output.printHelp('Usage: aspyn log <name> [--action | --state]');
    return EXIT_USAGE;
  }

  const showAction = flagBool(args, 'action');
  const showState = flagBool(args, 'state');

  if (showState) {
    // Delegate to cmdStateHistory with the pipeline name
    const histArgs: ParsedArgs = { positional: [name], flags: {} };
    return cmdStateHistory(histArgs);
  }

  let logPath: string;
  if (showAction) {
    logPath = actionLogPath(name);
  } else {
    logPath = runLogPath(name);
  }

  try {
    const content = await fs.readFile(logPath, 'utf-8');
    process.stdout.write(content);
    output.markExternalOutput();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      output.printHelp(`No log file found at ${logPath}`);
    } else {
      throw err;
    }
  }

  return EXIT_SUCCESS;
}

async function cmdValidate(args: ParsedArgs): Promise<number> {
  const jsonFormat = flagStr(args, 'format') === 'json';
  const results = await validateAll();

  if (jsonFormat) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    output.markExternalOutput();
    return results.some((r) => r.errors.length > 0)
      ? EXIT_STEP_ERROR
      : EXIT_SUCCESS;
  }

  let hasErrors = false;
  for (const r of results) {
    const ok = r.errors.length === 0;
    if (!ok) hasErrors = true;
    const msg =
      r.errors.length > 0
        ? r.errors.map((e) => e.message).join('; ')
        : undefined;
    output.printValidation(r.pipeline, ok, msg);
    for (const w of r.warnings) {
      output.printHelp(`  ${chalk.yellow('⚠')} ${w.message}`);
    }
  }

  return hasErrors ? EXIT_STEP_ERROR : EXIT_SUCCESS;
}

async function cmdInit(args: ParsedArgs): Promise<number> {
  const name = args.positional[0];
  if (!name) {
    output.printHelp('Usage: aspyn init <name>');
    return EXIT_USAGE;
  }

  const dir = pipelineConfigDir(name);
  const cfgPath = pipelineConfigPath(name);

  try {
    await fs.stat(cfgPath);
    output.printHelp(`Pipeline "${name}" already exists at ${cfgPath}`);
    return EXIT_ASPYN_ERROR;
  } catch {
    /* ok, doesn't exist */
  }

  const steps = CANONICAL_STEP_NAMES.map((s) => {
    const type =
      s === 'input'
        ? 'http'
        : s === 'parse'
          ? 'jsonpath'
          : s === 'check'
            ? 'expr'
            : 'log';
    let input: Record<string, unknown>;
    switch (type) {
      case 'http':
        input = { url: 'https://example.com' };
        break;
      case 'jsonpath':
        input = { queries: { value: '$.data' } };
        break;
      case 'expr':
        input = { expression: 'true' };
        break;
      default:
        input = {};
        break;
    }
    return { name: s, type, input };
  });

  const config = {
    name,
    description: `${name} pipeline`,
    interval: '1h',
    pipeline: steps,
  };

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(cfgPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

  output.printHelp(`Created ${cfgPath}`);
  return EXIT_SUCCESS;
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const raw = process.argv.slice(2);
  const args = parseArgs(raw);
  const cmd = args.positional.shift();

  if (!cmd || cmd === 'help' || flagBool(args, 'help')) {
    output.printHelp(USAGE);
    return EXIT_USAGE;
  }

  switch (cmd) {
    case 'run':
      return cmdRun(args);
    case 'daemon':
      return cmdDaemon(args);
    case 'list':
      return cmdList();
    case 'state': {
      const sub = args.positional.shift();
      switch (sub) {
        case 'list':
          return cmdStateList();
        case 'show':
          return cmdStateShow(args);
        case 'history':
          return cmdStateHistory(args);
        case 'diff':
          return cmdStateDiff(args);
        case 'clear':
          return cmdStateClear(args);
        default:
          output.printHelp('Usage: aspyn state <list|show|history|diff|clear>');
          return EXIT_USAGE;
      }
    }
    case 'log':
      return cmdLog(args);
    case 'validate':
      return cmdValidate(args);
    case 'init':
      return cmdInit(args);
    default:
      output.printHelp(`Unknown command: ${cmd}\n${USAGE}`);
      return EXIT_USAGE;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_ASPYN_ERROR);
  },
);

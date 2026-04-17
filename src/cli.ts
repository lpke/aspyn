#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { runWatch } from "./runner.js";
import type { RunResult } from "./runner.js";
import { loadWatchConfig, discoverWatches, loadGlobalConfig } from "./config/loader.js";
import { validateWatchConfig } from "./config/validator.js";
import { getWatchDir, getActionLogPath, getRunLogPath, getStateHistoryPath } from "./config/paths.js";
import { loadState } from "./state/manager.js";
import { intervalToMs } from "./scheduling/interval.js";
import { cmdDaemon } from "./daemon.js";
import { output } from "./output.js";
import { logger, initGlobalLogger } from "./logger.js";

// ── Arg parsing ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
const subcommand = args[0];

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function positional(index: number): string | undefined {
  const positionals = args.slice(1).filter((a) => !a.startsWith("--"));
  return positionals[index];
}

// ── Subcommands ─────────────────────────────────────────────────────

async function cmdRun(): Promise<void> {
  const globalConfig = await loadGlobalConfig();
  initGlobalLogger({ level: globalConfig.log?.level ?? "info" });

  const name = positional(0);
  const verbose = hasFlag("verbose");
  const dryRun = hasFlag("dry");
  const all = hasFlag("all");

  if (name) {
    const start = Date.now();
    let result: RunResult;
    try {
      result = await runWatch(name, { dryRun });
    } catch (err) {
      result = { success: false, value: null, error: (err as Error).message, skipped: false };
    }
    const elapsed = Date.now() - start;
    const status = result.skipped ? "skipped" : result.success ? "ok" : "error";
    output.markExternalOutput();

    const blockOpts: Parameters<typeof output.printWatchBlock>[1] = {};
    if (result.dryRunActions) blockOpts.dryRunActions = result.dryRunActions;
    if (verbose) blockOpts.result = result;
    if (!result.success && !result.skipped && !verbose) blockOpts.error = result.error ?? undefined;

    if (blockOpts.dryRunActions || blockOpts.result || blockOpts.error) {
      output.printWatchBlock(name, blockOpts);
    }

    output.printSummaryTable([{ name, status, duration: `${elapsed}ms` }]);
    if (!result.success && !result.skipped) process.exit(1);
  } else if (!all) {
    console.log(`Usage: aspyn run <name> [--verbose] [--dry]`);
    console.log(`       aspyn run --all [--verbose] [--dry]`);
    console.log(`Provide a watch name, or use --all to run all watches.`);
    return;
  } else {
    const watches = await discoverWatches();
    const rows: Array<{ name: string; status: string; duration: string }> = [];
    let failed = false;
    let totalMs = 0;
    let first = true;

    for (const watchName of watches) {
      if (!first) output.sectionGap();
      first = false;

      output.printWatchHeader(watchName);
      output.markExternalOutput();

      const start = Date.now();
      let result: RunResult;
      try {
        result = await runWatch(watchName, { dryRun });
      } catch (err) {
        result = { success: false, value: null, error: (err as Error).message, skipped: false };
      }
      const elapsed = Date.now() - start;
      totalMs += elapsed;
      const status = result.skipped ? "skipped" : result.success ? "ok" : "error";
      if (!result.success && !result.skipped) failed = true;
      rows.push({ name: watchName, status, duration: `${elapsed}ms` });

      const blockOpts: Parameters<typeof output.printWatchBlock>[1] = { showName: false };
      if (result.dryRunActions) blockOpts.dryRunActions = result.dryRunActions;
      if (verbose) blockOpts.result = result;
      if (!result.success && !result.skipped && !verbose) blockOpts.error = result.error ?? undefined;

      if (blockOpts.dryRunActions || blockOpts.result || blockOpts.error) {
        output.printWatchBlock(watchName, blockOpts);
      }
    }

    output.printSummaryTable(rows);
    output.printTotalLine(totalMs);
    if (failed) process.exit(1);
  }
}

async function cmdList(): Promise<void> {
  const globalConfig = await loadGlobalConfig();
  initGlobalLogger({ level: globalConfig.log?.level ?? "info" });

  const watches = await discoverWatches();
  const rows: Array<{ name: string; interval: string; lastRun: string; status: string; nextRun: string }> = [];

  for (const name of watches) {
    const state = await loadState(name);
    let interval = "?";
    try {
      const config = await loadWatchConfig(name);
      interval = config.interval;
    } catch { /* skip */ }

    const lastRun = state.lastRun
      ? new Date(state.lastRun).toLocaleString()
      : "never";
    const status = state.lastStatus;

    let nextRun = "\u2014";
    if (state.lastRun && interval !== "?") {
      try {
        const ms = intervalToMs(interval);
        const next = new Date(new Date(state.lastRun).getTime() + ms);
        nextRun = next.toLocaleString();
      } catch { /* skip */ }
    }

    rows.push({ name, interval, lastRun, status, nextRun });
  }

  output.printListTable(rows);
}

async function cmdLog(): Promise<void> {
  const name = positional(0);
  if (!name) {
    console.error("Usage: aspyn log <name> [--action] [--state]");
    process.exit(1);
  }

  const showAction = hasFlag("action");
  const showState = hasFlag("state");

  if (showState) {
    const historyPath = getStateHistoryPath(name);
    let content: string;
    try {
      content = await fs.readFile(historyPath, "utf-8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        console.log(`No state history for '${name}'`);
        return;
      }
      throw err;
    }

    const lines = content.trimEnd().split("\n");
    const entries = lines.map((line) => JSON.parse(line));
    output.printStateHistory(entries);
    return;
  }

  const logPath = showAction ? getActionLogPath(name) : getRunLogPath(name);
  const label = showAction ? "action" : "run";

  let content: string;
  try {
    content = await fs.readFile(logPath, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.log(`No ${label} logs for '${name}'`);
      return;
    }
    throw err;
  }

  const lines = content.trimEnd().split("\n");
  const last50 = lines.slice(-50);
  console.log(last50.join("\n"));
}

async function cmdState(): Promise<void> {
  const name = positional(0);
  if (!name) {
    console.error("Usage: aspyn state <name>");
    process.exit(1);
  }

  const state = await loadState(name);
  if (state.lastRun === null && state.runCount === 0) {
    console.log(`No state for '${name}' (never run)`);
    return;
  }

  console.log(JSON.stringify(state, null, 2));
}

async function cmdValidate(): Promise<void> {
  const globalConfig = await loadGlobalConfig();
  initGlobalLogger({ level: globalConfig.log?.level ?? "info" });

  const watches = await discoverWatches();
  let anyInvalid = false;

  for (const name of watches) {
    try {
      const config = await loadWatchConfig(name);
      validateWatchConfig(config, name);
      output.printValidation(name, true);
    } catch (err) {
      anyInvalid = true;
      output.printValidation(name, false, (err as Error).message);
    }
  }

  if (anyInvalid) process.exit(1);
}

async function cmdInit(): Promise<void> {
  const name = positional(0);
  if (!name) {
    console.error("Usage: aspyn init <name>");
    process.exit(1);
  }

  const watchDir = getWatchDir(name);

  try {
    await fs.access(watchDir);
    console.error(`Error: Watch '${name}' already exists at ${watchDir}. Use a different name or remove the existing watch first.`);
    process.exit(1);
  } catch { /* does not exist — proceed */ }

  await fs.mkdir(watchDir, { recursive: true });

  const configPath = path.join(watchDir, "config.jsonc");
  const template = `{
  // Watch interval — shorthand (e.g. "30s", "5m", "1h") or cron expression
  // "interval": "5m",

  // Source step — where data comes from
  // "source": "curl -s https://example.com",
  // "source": { "type": "http", "input": { "url": "https://example.com" } },
  // "source": { "type": "file", "input": { "path": "/tmp/data.json" } },

  // Parse step — extract structured data from source output
  // "parse": { "type": "json", "input": { "queries": { "title": "$.title" } } },
  // "parse": { "type": "regex", "input": { "patterns": { "version": "v(\\\\d+\\\\.\\\\d+)" } } },

  // Check step — condition that must be true for actions to run
  // "check": { "type": "expr", "input": { "expression": "changed" } },

  // Action step — what to do when check passes
  // "action": "echo 'Something changed!'",
  // "action": { "type": "desktop", "input": { "title": "Alert", "message": "Change detected" } },
  // "action": { "type": "webhook", "input": { "url": "https://hooks.example.com/notify" } },

  // Optional settings
  // "description": "Describe what this watch does",
  // "timeout": 30,
  // "missedRunPolicy": "run_once",
  // "retry": { "attempts": 3, "backoff": "exponential", "initialDelay": "1s" }
}
`;

  await fs.writeFile(configPath, template, "utf-8");
  console.log(`Created ~/.config/aspyn/${name}/config.jsonc`);
}

function printHelpCmd(): void {
  output.printHelp(`Usage: aspyn <command> [options]

Commands:
  aspyn run <name>           Run a single watch once, then exit
  aspyn run --all             Run all watches once, then exit
  aspyn daemon               Start the scheduler
  aspyn list                 List watches with status and next run time
  aspyn log <name>                  Show a watch's run log
  aspyn log <name> --action         Show data log (action log)
  aspyn log <name> --state          Show state history
  aspyn state <name>         Print current state for a watch
  aspyn validate             Validate all watch configs
  aspyn init <name>          Scaffold a new watch directory`);
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  switch (subcommand) {
    case "run":
      return cmdRun();
    case "daemon":
      return cmdDaemon();
    case "list":
      return cmdList();
    case "log":
      return cmdLog();
    case "state":
      return cmdState();
    case "validate":
      return cmdValidate();
    case "init":
      return cmdInit();
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelpCmd();
      return;
    default:
      console.error(`Unknown command: ${subcommand}`);
      printHelpCmd();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});

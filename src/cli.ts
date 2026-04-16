#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { runWatch } from "./runner.js";
import { loadWatchConfig, discoverWatches } from "./config/loader.js";
import { validateWatchConfig } from "./config/validator.js";
import { getWatchDir, getActionLogPath, getStateHistoryPath } from "./config/paths.js";
import { loadState } from "./state/manager.js";
import { intervalToMs } from "./scheduling/interval.js";
import { cmdDaemon } from "./daemon.js";
import type { PipelineResult } from "./types/pipeline.js";

// ── Arg parsing ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
const subcommand = args[0];

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function positional(index: number): string | undefined {
  // positional args are non-flag args after subcommand
  const positionals = args.slice(1).filter((a) => !a.startsWith("--"));
  return positionals[index];
}

// ── Helpers ─────────────────────────────────────────────────────────

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  console.log(headers.map((h, i) => padRight(h, widths[i])).join("  "));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) {
    console.log(row.map((c, i) => padRight(c, widths[i])).join("  "));
  }
}

// ── Subcommands ─────────────────────────────────────────────────────

async function cmdRun(): Promise<void> {
  const name = positional(0);
  const verbose = hasFlag("verbose");
  const dryRun = hasFlag("dry");
  const all = hasFlag("all");

  if (name) {
    const start = Date.now();
    try {
      const result = await runWatch(name, { verbose, dryRun });
      const status = result.skipped ? "skipped" : result.success ? "ok" : "error";
      const duration = `${Date.now() - start}ms`;
      printTable(["NAME", "STATUS", "DURATION"], [[name, status, duration]]);
      if (!result.success && !result.skipped) process.exit(1);
    } catch (err) {
      const duration = `${Date.now() - start}ms`;
      printTable(["NAME", "STATUS", "DURATION"], [[name, "error", duration]]);
      console.error((err as Error).message);
      process.exit(1);
    }
  } else if (!all) {
    console.log(`Usage: aspyn run <name> [--verbose] [--dry]`);
    console.log(`       aspyn run --all [--verbose] [--dry]`);
    console.log(`Provide a watch name, or use --all to run all watches.`);
    return;
  } else {
    const watches = await discoverWatches();
    const rows: string[][] = [];
    let failed = false;
    let totalMs = 0;

    for (const watchName of watches) {
      const start = Date.now();
      let result: PipelineResult;
      try {
        result = await runWatch(watchName, { verbose, dryRun });
      } catch (err) {
        result = { success: false, value: null, error: (err as Error).message, skipped: false };
      }
      const elapsed = Date.now() - start;
      totalMs += elapsed;
      const status = result.skipped ? "skipped" : result.success ? "ok" : "error";
      if (!result.success && !result.skipped) failed = true;
      rows.push([watchName, status, `${elapsed}ms`]);
    }

    printTable(["NAME", "STATUS", "DURATION"], rows);
    const totalSec = (totalMs / 1000).toFixed(1);
    console.log(`Total: ${totalSec}s`);
    if (failed) process.exit(1);
  }
}



async function cmdList(): Promise<void> {
  const watches = await discoverWatches();
  const rows: string[][] = [];

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

    let nextRun = "?";
    if (state.lastRun && interval !== "?") {
      try {
        const ms = intervalToMs(interval);
        const next = new Date(new Date(state.lastRun).getTime() + ms);
        nextRun = next.toLocaleString();
      } catch { /* skip */ }
    }

    rows.push([name, interval, lastRun, status, nextRun]);
  }

  printTable(["NAME", "INTERVAL", "LAST RUN", "STATUS", "NEXT RUN"], rows);
}

async function cmdLog(): Promise<void> {
  const name = positional(0);
  if (!name) {
    console.error("Usage: aspyn log <name> [--state]");
    process.exit(1);
  }

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
    for (const line of lines) {
      const entry = JSON.parse(line);
      const ts = entry.timestamp;
      const status = entry.status;
      const runCount = entry.runCount;
      const valueSummary = entry.value != null ? JSON.stringify(entry.value).slice(0, 80) : "null";
      let out = `[${ts}] status=${status} runCount=${runCount} value=${valueSummary}`;
      if (entry.error) out += ` error=${entry.error}`;
      console.log(out);
    }
    return;
  }

  const logPath = getActionLogPath(name);

  let content: string;
  try {
    content = await fs.readFile(logPath, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.log(`No logs for '${name}'`);
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
  const watches = await discoverWatches();
  let anyInvalid = false;

  for (const name of watches) {
    try {
      const config = await loadWatchConfig(name);
      validateWatchConfig(config, name);
      console.log(`✓ ${name} (ok)`);
    } catch (err) {
      anyInvalid = true;
      console.log(`✗ ${name} (${(err as Error).message})`);
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

function printHelp(): void {
  console.log(`Usage: aspyn <command> [options]

Commands:
  aspyn run <name>           Run a single watch once, then exit
  aspyn run --all             Run all watches once, then exit
  aspyn daemon               Start the scheduler
  aspyn list                 List watches with status and next run time
  aspyn log <name>                  Show a watch's log
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
      printHelp();
      return;
    default:
      console.error(`Unknown command: ${subcommand}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});

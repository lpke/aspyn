import chalk from "chalk";
import type { TypedActionHandler } from "./types/config.js";
import type { PipelineResult } from "./types/pipeline.js";
import type { StateHistoryEntry } from "./types/state.js";

// ── State ───────────────────────────────────────────────────────────

let hasPrinted = false;

// ── Helpers ─────────────────────────────────────────────────────────

function write(text: string): void {
  hasPrinted = true;
  process.stdout.write(text + "\n");
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function statusColor(status: string): string {
  if (status === "ok") return chalk.green(status);
  if (status === "skipped") return chalk.yellow(status);
  if (status === "error") return chalk.red(status);
  return status;
}

function actionSummary(action: string | TypedActionHandler): string {
  if (typeof action === "string") return action;
  switch (action.type) {
    case "log": return `log (${action.input.format ?? "json"})`;
    case "desktop": return `desktop ("${action.input.title ?? "aspyn"}")`;
    case "webhook": return `webhook (POST ${action.input.url})`;
    case "shell": return `shell ("${action.input.command}")`;
  }
}

// ── Section gap ─────────────────────────────────────────────────────

function sectionGap(): void {
  if (hasPrinted) write("");
}

// ── Watch block ─────────────────────────────────────────────────────

interface WatchBlockOptions {
  dryRunActions?: Array<string | TypedActionHandler>;
  result?: PipelineResult;
  error?: string;
  showName?: boolean;
}

function printWatchBlock(watchName: string, options: WatchBlockOptions): void {
  const { dryRunActions, result, error, showName } = options;

  if (showName) {
    write(chalk.cyan.bold(watchName));
  }

  if (dryRunActions) {
    write(`${chalk.bold("Dry run:")} would execute ${dryRunActions.length} action(s):`);
    for (const a of dryRunActions) {
      write(`  - ${actionSummary(a)}`);
    }
  }

  if (result) {
    write(chalk.bold("Result:"));
    write("  " + chalk.dim(JSON.stringify(result, null, 2).split("\n").join("\n  ")));
  }

  if (error && !result) {
    write(`${chalk.cyan.bold(watchName)}: ${chalk.red(error)}`);
  }
}

// ── Summary table ───────────────────────────────────────────────────

interface SummaryRow {
  name: string;
  status: string;
  duration: string;
}

function printSummaryTable(rows: SummaryRow[]): void {
  sectionGap();
  const headers = ["NAME", "STATUS", "DURATION"];
  const data = rows.map(r => [r.name, r.status, r.duration]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map(r => r[i].length)),
  );

  write(headers.map((h, i) => chalk.bold(padRight(h, widths[i]))).join("  "));
  write(chalk.dim(widths.map(w => "-".repeat(w)).join("  ")));
  for (const row of data) {
    const cells = [
      padRight(row[0], widths[0]),
      padRight(statusColor(row[1]), widths[1] + (statusColor(row[1]).length - row[1].length)),
      chalk.dim(padRight(row[2], widths[2])),
    ];
    write(cells.join("  "));
  }
}

function printTotalLine(totalMs: number): void {
  const sec = (totalMs / 1000).toFixed(1);
  write(`${chalk.bold("Total:")} ${chalk.dim(`${sec}s`)}`);
}

// ── List table ──────────────────────────────────────────────────────

interface ListRow {
  name: string;
  interval: string;
  lastRun: string;
  status: string;
  nextRun: string;
}

function printListTable(rows: ListRow[]): void {
  const headers = ["NAME", "INTERVAL", "LAST RUN", "STATUS", "NEXT RUN"];
  const data = rows.map(r => [r.name, r.interval, r.lastRun, r.status, r.nextRun]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map(r => r[i].length)),
  );

  write(headers.map((h, i) => chalk.bold(padRight(h, widths[i]))).join("  "));
  write(chalk.dim(widths.map(w => "-".repeat(w)).join("  ")));
  for (const row of data) {
    const cells = row.map((cell, i) => {
      let styled = cell;
      if (i === 3) styled = statusColor(cell);
      else if (cell === "never") styled = chalk.dim(cell);
      const extra = styled.length - cell.length;
      return padRight(styled, widths[i] + extra);
    });
    write(cells.join("  "));
  }
}

// ── Validation ──────────────────────────────────────────────────────

function printValidation(name: string, ok: boolean, errorMsg?: string): void {
  if (ok) {
    write(`${chalk.green("✓")} ${name}`);
  } else {
    write(`${chalk.red("✗")} ${name} ${chalk.dim(`(${errorMsg})`)}`);
  }
}

// ── Help ────────────────────────────────────────────────────────────

function printHelp(text: string): void {
  // Bold command names (aspyn <word>)
  const bolded = text.replace(/aspyn \S+/g, (m) => chalk.bold(m));
  write(bolded);
}

// ── Export ───────────────────────────────────────────────────────────

function markExternalOutput(): void {
  hasPrinted = true;
}

// ── State History ───────────────────────────────────────────────────

function printStateHistory(entries: StateHistoryEntry[]): void {
  if (entries.length === 0) {
    write("No state history entries.");
    return;
  }

  for (const entry of entries) {
    const ts = chalk.dim(entry.timestamp);
    const status = statusColor(entry.status);
    const valueSummary = chalk.dim(
      entry.value != null
        ? JSON.stringify(entry.value).slice(0, 80)
        : "null",
    );
    let line = `${ts}  ${status}  run=${entry.runCount}  value=${valueSummary}`;
    if (entry.error) line += `  ${chalk.red(entry.error)}`;
    write(line);
  }
}

function printWatchHeader(name: string): void {
  process.stdout.write(chalk.cyan.bold(name) + "\n");
  hasPrinted = true;
}

export const output = {
  sectionGap,
  printWatchBlock,
  printSummaryTable,
  printTotalLine,
  printListTable,
  printValidation,
  printHelp,
  markExternalOutput,
  printStateHistory,
  printWatchHeader,
};

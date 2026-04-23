import chalk from 'chalk';
import type { StateHistoryEntry } from './types/state.js';

// ── State ───────────────────────────────────────────────────────────

let hasPrinted = false;

// ── Helpers ─────────────────────────────────────────────────────────

function write(text: string): void {
  hasPrinted = true;
  process.stdout.write(text + '\n');
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function statusColor(status: string): string {
  if (status === 'ok') return chalk.green(status);
  if (status === 'skipped') return chalk.yellow(status);
  if (status === 'halted') return chalk.yellow(status);
  if (status === 'error') return chalk.red(status);
  if (status === 'interrupted') return chalk.red(status);
  return status;
}

function actionSummary(handlerType: string): string {
  switch (handlerType) {
    case 'http':
      return 'http';
    case 'shell':
      return 'shell';
    case 'notification-desktop':
      return 'notification-desktop';
    case 'log':
      return 'log';
    default:
      return handlerType;
  }
}

// ── Section gap ─────────────────────────────────────────────────────

function sectionGap(): void {
  if (hasPrinted) write('');
}

// ── Watch block ─────────────────────────────────────────────────────

interface WatchBlockOptions {
  dryRunActions?: string[];
  result?: Record<string, unknown>;
  error?: string;
  showName?: boolean;
}

function printWatchBlock(watchName: string, options: WatchBlockOptions): void {
  const { dryRunActions, result, error, showName } = options;

  if (showName) {
    write(chalk.cyan.bold(watchName));
  }

  if (dryRunActions) {
    write(
      `${chalk.bold('Dry run:')} would execute ${dryRunActions.length} action(s):`,
    );
    for (const a of dryRunActions) {
      write(`  - ${actionSummary(a)}`);
    }
  }

  if (result) {
    write(chalk.bold('Result:'));
    write(
      '  ' +
        chalk.dim(JSON.stringify(result, null, 2).split('\n').join('\n  ')),
    );
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
  const headers = ['NAME', 'STATUS', 'DURATION'];
  const data = rows.map((r) => [r.name, r.status, r.duration]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map((r) => r[i].length)),
  );

  write(headers.map((h, i) => chalk.bold(padRight(h, widths[i]))).join('  '));
  write(chalk.dim(widths.map((w) => '-'.repeat(w)).join('  ')));
  for (const row of data) {
    const cells = [
      padRight(row[0], widths[0]),
      padRight(
        statusColor(row[1]),
        widths[1] + (statusColor(row[1]).length - row[1].length),
      ),
      chalk.dim(padRight(row[2], widths[2])),
    ];
    write(cells.join('  '));
  }
}

function printTotalLine(totalMs: number): void {
  const sec = (totalMs / 1000).toFixed(1);
  write(`${chalk.bold('Total:')} ${chalk.dim(`${sec}s`)}`);
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
  const headers = ['NAME', 'INTERVAL', 'LAST RUN', 'STATUS', 'NEXT RUN'];
  const data = rows.map((r) => [
    r.name,
    r.interval,
    r.lastRun,
    r.status,
    r.nextRun,
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map((r) => r[i].length)),
  );

  write(headers.map((h, i) => chalk.bold(padRight(h, widths[i]))).join('  '));
  write(chalk.dim(widths.map((w) => '-'.repeat(w)).join('  ')));
  for (const row of data) {
    const cells = row.map((cell, i) => {
      let styled = cell;
      if (i === 3) styled = statusColor(cell);
      else if (cell === 'never') styled = chalk.dim(cell);
      const extra = styled.length - cell.length;
      return padRight(styled, widths[i] + extra);
    });
    write(cells.join('  '));
  }
}

// ── Validation ──────────────────────────────────────────────────────

function printValidation(name: string, ok: boolean, errorMsg?: string): void {
  if (ok) {
    write(`${chalk.green('✓')} ${name}`);
  } else {
    write(`${chalk.red('✗')} ${name} ${chalk.dim(`(${errorMsg})`)}`);
  }
}

// ── Help ────────────────────────────────────────────────────────────

function printHelp(text: string): void {
  const bolded = text.replace(/aspyn \S+/g, (m) => chalk.bold(m));
  write(bolded);
}

function printInstallHint(msg: string): void {
  process.stderr.write('\n' + chalk.red(msg) + '\n');
}

// ── Export ───────────────────────────────────────────────────────────

function markExternalOutput(): void {
  hasPrinted = true;
}

// ── State History ───────────────────────────────────────────────────

function printStateHistory(
  entries: StateHistoryEntry[],
  format: 'table' | 'json' | 'tsv' = 'table',
): void {
  if (entries.length === 0) {
    write('No state history entries.');
    return;
  }

  if (format === 'json') {
    write(JSON.stringify(entries, null, 2));
    return;
  }

  if (format === 'tsv') {
    write(
      [
        'runId',
        'startedAt',
        'endedAt',
        'durationMs',
        'runNumber',
        'status',
        'halt',
        'error',
        'warnings',
        'softErrors',
      ].join('\t'),
    );
    for (const e of entries) {
      write(
        [
          e.runId,
          e.startedAt,
          e.endedAt,
          String(e.durationMs),
          String(e.runNumber),
          e.status,
          e.halt ? `${e.halt.atStep}:${e.halt.reason}` : '',
          e.error ?? '',
          String(e.warnings.length),
          String(e.softErrors.length),
        ].join('\t'),
      );
    }
    return;
  }

  // table format
  for (const entry of entries) {
    const ts = chalk.dim(entry.startedAt);
    const status = statusColor(entry.status);
    const dur = chalk.dim(`${entry.durationMs}ms`);
    let line = `${ts}  ${status}  run=#${entry.runNumber}  dur=${dur}`;
    if (entry.halt)
      line += `  halt=${chalk.yellow(`${entry.halt.atStep}:${entry.halt.reason}`)}`;
    if (entry.error) line += `  ${chalk.red(entry.error)}`;
    if (entry.warnings.length > 0)
      line += `  warnings=${entry.warnings.length}`;
    if (entry.softErrors.length > 0)
      line += `  softErrors=${entry.softErrors.length}`;
    write(line);
  }
}

function printWatchHeader(name: string): void {
  process.stdout.write(chalk.cyan.bold(name) + '\n');
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
  printInstallHint,
};

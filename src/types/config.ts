// ── Source handler types ─────────────────────────────────────────────

export interface HttpSourceInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface WebpageSourceInput {
  url: string;
  waitFor?: string;
  timeout?: number;
  javascript?: boolean;
}

export interface FileSourceInput {
  path: string;
  encoding?: string;
}

export interface ShellSourceInput {
  command: string;
  timeout?: number;
}

export type TypedSourceHandler =
  | { type: "http"; input: HttpSourceInput }
  | { type: "webpage"; input: WebpageSourceInput }
  | { type: "file"; input: FileSourceInput }
  | { type: "shell"; input: ShellSourceInput };

// ── Parse handler types ─────────────────────────────────────────────

export interface SelectorParseInput {
  selectors: Record<string, string>;
}

export interface JsonParseInput {
  queries: Record<string, string>;
}

export interface RegexParseInput {
  patterns: Record<string, string>;
  source?: string;
}

export type TypedParseHandler =
  | { type: "selector"; input: SelectorParseInput }
  | { type: "json"; input: JsonParseInput }
  | { type: "regex"; input: RegexParseInput };

// ── Check handler types ─────────────────────────────────────────────

export interface ExprCheckInput {
  expression: string;
}

export type TypedCheckHandler = { type: "expr"; input: ExprCheckInput };

// ── Action handler types ────────────────────────────────────────────

export interface WebhookActionInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface DesktopActionInput {
  title?: string;
  message?: string;
  sound?: boolean;
}

export interface ShellActionInput {
  command: string;
  timeout?: number;
}

export interface LogActionInput {
  format?: "json" | "text";
}

export type TypedActionHandler =
  | { type: "webhook"; input: WebhookActionInput }
  | { type: "desktop"; input: DesktopActionInput }
  | { type: "shell"; input: ShellActionInput }
  | { type: "log"; input: LogActionInput };

// ── Retry config ────────────────────────────────────────────────────

export interface RetryConfig {
  attempts: number;
  backoff: "fixed" | "linear" | "exponential";
  initialDelay: string;
}

// ── Missed-run policy ───────────────────────────────────────────────

export type MissedRunPolicy = "run_once" | "skip" | "run_all";

// ── Watch config (per-watch config.jsonc) ───────────────────────────

export interface WatchConfig {
  interval: string;
  description?: string;
  source?: string | TypedSourceHandler;
  parse?: string | TypedParseHandler;
  check?: string | TypedCheckHandler;
  action: string | TypedActionHandler | Array<string | TypedActionHandler>;
  timeout?: number;
  retry?: RetryConfig;
  onError?: string | TypedActionHandler;
  missedRunPolicy?: MissedRunPolicy;
  log?: { level?: "debug" | "info" | "warn" | "error"; maxFileSize?: string; maxFiles?: number };
  stateHistory?: { maxFileSize?: string; maxFiles?: number };
}

// ── Global config (~/.config/aspyn/config.jsonc) ────────────────────

export interface GlobalConfig {
  defaultInterval?: string;
  defaultTimeout?: number;
  minInterval?: string;
  shutdownTimeout?: number;
  missedRunPolicy?: MissedRunPolicy;
  playwright?: {
    browser?: "chromium" | "firefox" | "webkit";
    headless?: boolean;
  };
  log?: {
    level?: "debug" | "info" | "warn" | "error";
    maxFileSize?: string;
    maxFiles?: number;
  };
  stateHistory?: { maxFileSize?: string; maxFiles?: number };
}

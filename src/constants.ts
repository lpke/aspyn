// ── App ──────────────────────────────────────────────────────────────
export const APP_NAME = "aspyn";

// ── File names ───────────────────────────────────────────────────────
export const CONFIG_FILE = "config.jsonc";
export const STATE_FILE = "state.json";
export const STATE_HISTORY_FILE = "state-history.jsonl";
export const RUN_LOCK_FILE = "run.lock.jsonl";
export const CONCURRENCY_LOCK_FILE = "lock";
export const RUN_LOG_FILE = "run.log";
export const ACTION_LOG_FILE = "action.log";

// ── Defaults ─────────────────────────────────────────────────────────
export const DEFAULT_INTERVAL = "1h";
export const DEFAULT_TIMEOUT_SECONDS = 30;
export const MIN_INTERVAL = "1s";
export const SHUTDOWN_TIMEOUT_MS = 30_000;
export const DEFAULT_ROTATION_MAX_FILE_SIZE = "5mb";
export const DEFAULT_ROTATION_MAX_FILES = 5;
export const DAEMON_PIPELINE_SCAN_INTERVAL_MS = 60_000;

// ── Enums ────────────────────────────────────────────────────────────
export const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const RUN_STATUSES = ["ok", "error", "halted", "interrupted", "skipped"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const MISSED_RUN_POLICIES = ["run_once", "skip", "run_all"] as const;
export type MissedRunPolicy = (typeof MISSED_RUN_POLICIES)[number];

export const JOURNAL_EVENTS = ["run_start", "step_start", "step_output", "step_end", "context_file", "run_end"] as const;
export type JournalEventType = (typeof JOURNAL_EVENTS)[number];

export const HALT_REASONS = ["gate_falsy", "expr_throw", "timeout", "handler_throw", "aspyn_level"] as const;
export type HaltReason = (typeof HALT_REASONS)[number];

export const HANDLER_TYPES = ["http", "webpage", "file", "shell", "css-selector", "jsonpath", "regex", "expr", "notification-desktop", "log"] as const;
export type HandlerType = (typeof HANDLER_TYPES)[number];

// ── Canonical recipe step names ──────────────────────────────────────
export const CANONICAL_STEP_NAMES = ["input", "parse", "check", "action"] as const;
export type CanonicalStepName = (typeof CANONICAL_STEP_NAMES)[number];

// ── Env vars ─────────────────────────────────────────────────────────
export const ENV_CONTEXT_FILE = "ASPYN_CONTEXT_FILE";

// ── Exit codes ───────────────────────────────────────────────────────
export const EXIT_SUCCESS = 0;
export const EXIT_STEP_ERROR = 1;
export const EXIT_ASPYN_ERROR = 2;
export const EXIT_LOCK_HELD = 3;
export const EXIT_USAGE = 4;

// ── Shell ────────────────────────────────────────────────────────────
export const SHELL_SIGKILL_GRACE_MS = 2_000;
export const SHELL_TIMEOUT_EXIT_CODE = 124;

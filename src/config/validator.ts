import type {
  GlobalConfig,
  WatchConfig,
  TypedSourceHandler,
  TypedParseHandler,
  TypedCheckHandler,
  TypedActionHandler,
  RetryConfig,
  MissedRunPolicy,
} from "../types/config.js";

// ── Helpers ─────────────────────────────────────────────────────────

function fail(watchName: string, message: string): never {
  throw new Error(`[${watchName}] ${message}`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── Valid type values per step ──────────────────────────────────────

const VALID_SOURCE_TYPES = new Set(["http", "webpage", "file", "shell"]);
const VALID_PARSE_TYPES = new Set(["selector", "json", "regex"]);
const VALID_CHECK_TYPES = new Set(["expr"]);
const VALID_ACTION_TYPES = new Set(["webhook", "desktop", "shell", "log"]);

// ── Typed handler validators ────────────────────────────────────────

function validateTypedSource(
  v: Record<string, unknown>,
  watchName: string,
): TypedSourceHandler {
  const t = v.type;
  if (typeof t !== "string" || !VALID_SOURCE_TYPES.has(t)) {
    fail(
      watchName,
      `Invalid source type "${String(t)}". Must be one of: ${[...VALID_SOURCE_TYPES].join(", ")}`,
    );
  }
  return v as unknown as TypedSourceHandler;
}

function validateTypedParse(
  v: Record<string, unknown>,
  watchName: string,
): TypedParseHandler {
  const t = v.type;
  if (typeof t !== "string" || !VALID_PARSE_TYPES.has(t)) {
    fail(
      watchName,
      `Invalid parse type "${String(t)}". Must be one of: ${[...VALID_PARSE_TYPES].join(", ")}`,
    );
  }
  return v as unknown as TypedParseHandler;
}

function validateTypedCheck(
  v: Record<string, unknown>,
  watchName: string,
): TypedCheckHandler {
  const t = v.type;
  if (typeof t !== "string" || !VALID_CHECK_TYPES.has(t)) {
    fail(
      watchName,
      `Invalid check type "${String(t)}". Must be one of: ${[...VALID_CHECK_TYPES].join(", ")}`,
    );
  }
  return v as unknown as TypedCheckHandler;
}

function validateTypedAction(
  v: Record<string, unknown>,
  watchName: string,
): TypedActionHandler {
  const t = v.type;
  if (typeof t !== "string" || !VALID_ACTION_TYPES.has(t)) {
    fail(
      watchName,
      `Invalid action type "${String(t)}". Must be one of: ${[...VALID_ACTION_TYPES].join(", ")}`,
    );
  }
  return v as unknown as TypedActionHandler;
}

// ── Step validators (string | typed object) ─────────────────────────

function validateSource(
  v: unknown,
  watchName: string,
): string | TypedSourceHandler {
  if (typeof v === "string") return v;
  if (isObject(v) && "type" in v) return validateTypedSource(v, watchName);
  fail(watchName, `"source" must be a string or an object with a "type" field`);
}

function validateParse(
  v: unknown,
  watchName: string,
): string | TypedParseHandler {
  if (typeof v === "string") return v;
  if (isObject(v) && "type" in v) return validateTypedParse(v, watchName);
  fail(watchName, `"parse" must be a string or an object with a "type" field`);
}

function validateCheck(
  v: unknown,
  watchName: string,
): string | TypedCheckHandler {
  if (typeof v === "string") return v;
  if (isObject(v) && "type" in v) return validateTypedCheck(v, watchName);
  fail(watchName, `"check" must be a string or an object with a "type" field`);
}

function validateSingleAction(
  v: unknown,
  watchName: string,
): string | TypedActionHandler {
  if (typeof v === "string") return v;
  if (isObject(v) && "type" in v) return validateTypedAction(v, watchName);
  fail(
    watchName,
    `Each action must be a string or an object with a "type" field`,
  );
}

function validateAction(
  v: unknown,
  watchName: string,
): string | TypedActionHandler | Array<string | TypedActionHandler> {
  if (Array.isArray(v)) {
    if (v.length === 0) fail(watchName, `"action" array must not be empty`);
    return v.map((item) => validateSingleAction(item, watchName));
  }
  return validateSingleAction(v, watchName);
}

// ── Retry validator ─────────────────────────────────────────────────

const VALID_BACKOFF = new Set(["fixed", "linear", "exponential"]);

function validateRetry(
  v: unknown,
  watchName: string,
): RetryConfig {
  if (!isObject(v)) fail(watchName, `"retry" must be an object`);

  if (typeof v.attempts !== "number" || v.attempts < 1) {
    fail(watchName, `"retry.attempts" must be a positive number`);
  }
  if (typeof v.backoff !== "string" || !VALID_BACKOFF.has(v.backoff)) {
    fail(
      watchName,
      `"retry.backoff" must be one of: ${[...VALID_BACKOFF].join(", ")}`,
    );
  }
  if (typeof v.initialDelay !== "string" || v.initialDelay.length === 0) {
    fail(watchName, `"retry.initialDelay" must be a non-empty string`);
  }

  return v as unknown as RetryConfig;
}

// ── MissedRunPolicy validator ───────────────────────────────────────

const VALID_MISSED_RUN_POLICIES = new Set(["run_once", "skip", "run_all"]);

function validateMissedRunPolicy(
  v: unknown,
  watchName: string,
): MissedRunPolicy {
  if (typeof v !== "string" || !VALID_MISSED_RUN_POLICIES.has(v)) {
    fail(
      watchName,
      `"missedRunPolicy" must be one of: ${[...VALID_MISSED_RUN_POLICIES].join(", ")}`,
    );
  }
  return v as MissedRunPolicy;
}

// ── Public: validateWatchConfig ─────────────────────────────────────

export function validateWatchConfig(
  config: unknown,
  watchName: string,
): WatchConfig {
  if (!isObject(config)) {
    fail(watchName, "Config must be a JSON object");
  }

  // interval — required, non-empty string
  if (typeof config.interval !== "string" || config.interval.length === 0) {
    fail(watchName, `"interval" is required and must be a non-empty string`);
  }

  // action — required
  if (config.action === undefined || config.action === null) {
    fail(watchName, `"action" is required`);
  }

  const result: WatchConfig = {
    interval: config.interval,
    action: validateAction(config.action, watchName),
  };

  // description
  if (config.description !== undefined) {
    if (typeof config.description !== "string") {
      fail(watchName, `"description" must be a string`);
    }
    result.description = config.description;
  }

  // source
  if (config.source !== undefined) {
    result.source = validateSource(config.source, watchName);
  }

  // parse
  if (config.parse !== undefined) {
    result.parse = validateParse(config.parse, watchName);
  }

  // check
  if (config.check !== undefined) {
    result.check = validateCheck(config.check, watchName);
  }

  // timeout
  if (config.timeout !== undefined) {
    if (typeof config.timeout !== "number" || config.timeout <= 0) {
      fail(watchName, `"timeout" must be a positive number`);
    }
    result.timeout = config.timeout;
  }

  // retry
  if (config.retry !== undefined) {
    result.retry = validateRetry(config.retry, watchName);
  }

  // onError
  if (config.onError !== undefined) {
    result.onError = validateSingleAction(config.onError, watchName);
  }

  // missedRunPolicy
  if (config.missedRunPolicy !== undefined) {
    result.missedRunPolicy = validateMissedRunPolicy(
      config.missedRunPolicy,
      watchName,
    );
  }

  // stateHistory
  if (config.stateHistory !== undefined) {
    if (!isObject(config.stateHistory)) {
      fail(watchName, `"stateHistory" must be an object`);
    }
    const sh = config.stateHistory;
    result.stateHistory = {};
    if (sh.maxFileSize !== undefined) {
      if (typeof sh.maxFileSize !== "string") {
        fail(watchName, `"stateHistory.maxFileSize" must be a string`);
      }
      result.stateHistory.maxFileSize = sh.maxFileSize;
    }
    if (sh.maxFiles !== undefined) {
      if (typeof sh.maxFiles !== "number" || sh.maxFiles < 1) {
        fail(watchName, `"stateHistory.maxFiles" must be a positive number`);
      }
      result.stateHistory.maxFiles = sh.maxFiles;
    }
  }

  // log
  if (config.log !== undefined) {
    if (!isObject(config.log)) {
      fail(watchName, `"log" must be an object`);
    }
    const log = config.log;
    result.log = {};
    if (log.maxFileSize !== undefined) {
      if (typeof log.maxFileSize !== "string") {
        fail(watchName, `"log.maxFileSize" must be a string`);
      }
      result.log.maxFileSize = log.maxFileSize;
    }
    if (log.maxFiles !== undefined) {
      if (typeof log.maxFiles !== "number" || log.maxFiles < 1) {
        fail(watchName, `"log.maxFiles" must be a positive number`);
      }
      result.log.maxFiles = log.maxFiles;
    }
  }

  if (config.stateHistory !== undefined) {
    if (!isObject(config.stateHistory)) {
      throw new Error(`Global config: "stateHistory" must be an object`);
    }
    const sh = config.stateHistory;
    result.stateHistory = {};
    if (sh.maxFileSize !== undefined) {
      if (typeof sh.maxFileSize !== "string") {
        throw new Error(`Global config: "stateHistory.maxFileSize" must be a string`);
      }
      result.stateHistory.maxFileSize = sh.maxFileSize;
    }
    if (sh.maxFiles !== undefined) {
      if (typeof sh.maxFiles !== "number" || sh.maxFiles < 1) {
        throw new Error(`Global config: "stateHistory.maxFiles" must be a positive number`);
      }
      result.stateHistory.maxFiles = sh.maxFiles;
    }
  }

  return result;
}

// ── Public: validateGlobalConfig ────────────────────────────────────

export function validateGlobalConfig(config: unknown): GlobalConfig {
  if (!isObject(config)) {
    throw new Error("Global config must be a JSON object");
  }

  const result: GlobalConfig = {};

  if (config.defaultInterval !== undefined) {
    if (typeof config.defaultInterval !== "string") {
      throw new Error(`Global config: "defaultInterval" must be a string`);
    }
    result.defaultInterval = config.defaultInterval;
  }

  if (config.defaultTimeout !== undefined) {
    if (
      typeof config.defaultTimeout !== "number" ||
      config.defaultTimeout <= 0
    ) {
      throw new Error(
        `Global config: "defaultTimeout" must be a positive number`,
      );
    }
    result.defaultTimeout = config.defaultTimeout;
  }

  if (config.minInterval !== undefined) {
    if (typeof config.minInterval !== "string") {
      throw new Error(`Global config: "minInterval" must be a string`);
    }
    result.minInterval = config.minInterval;
  }

  if (config.shutdownTimeout !== undefined) {
    if (
      typeof config.shutdownTimeout !== "number" ||
      config.shutdownTimeout <= 0
    ) {
      throw new Error(
        `Global config: "shutdownTimeout" must be a positive number`,
      );
    }
    result.shutdownTimeout = config.shutdownTimeout;
  }

  if (config.missedRunPolicy !== undefined) {
    const v = config.missedRunPolicy;
    if (
      typeof v !== "string" ||
      !VALID_MISSED_RUN_POLICIES.has(v)
    ) {
      throw new Error(
        `Global config: "missedRunPolicy" must be one of: ${[...VALID_MISSED_RUN_POLICIES].join(", ")}`,
      );
    }
    result.missedRunPolicy = v as MissedRunPolicy;
  }

  if (config.playwright !== undefined) {
    if (!isObject(config.playwright)) {
      throw new Error(`Global config: "playwright" must be an object`);
    }
    const pw = config.playwright;
    const validBrowsers = new Set(["chromium", "firefox", "webkit"]);
    result.playwright = {};
    if (pw.browser !== undefined) {
      if (typeof pw.browser !== "string" || !validBrowsers.has(pw.browser)) {
        throw new Error(
          `Global config: "playwright.browser" must be one of: ${[...validBrowsers].join(", ")}`,
        );
      }
      result.playwright.browser = pw.browser as "chromium" | "firefox" | "webkit";
    }
    if (pw.headless !== undefined) {
      if (typeof pw.headless !== "boolean") {
        throw new Error(
          `Global config: "playwright.headless" must be a boolean`,
        );
      }
      result.playwright.headless = pw.headless;
    }
  }

  if (config.log !== undefined) {
    if (!isObject(config.log)) {
      throw new Error(`Global config: "log" must be an object`);
    }
    const log = config.log;
    const validLevels = new Set(["debug", "info", "warn", "error"]);
    result.log = {};
    if (log.level !== undefined) {
      if (typeof log.level !== "string" || !validLevels.has(log.level)) {
        throw new Error(
          `Global config: "log.level" must be one of: ${[...validLevels].join(", ")}`,
        );
      }
      result.log.level = log.level as "debug" | "info" | "warn" | "error";
    }
    if (log.maxFileSize !== undefined) {
      if (typeof log.maxFileSize !== "string") {
        throw new Error(
          `Global config: "log.maxFileSize" must be a string`,
        );
      }
      result.log.maxFileSize = log.maxFileSize;
    }
    if (log.maxFiles !== undefined) {
      if (typeof log.maxFiles !== "number" || log.maxFiles < 1) {
        throw new Error(
          `Global config: "log.maxFiles" must be a positive number`,
        );
      }
      result.log.maxFiles = log.maxFiles;
    }
  }

  return result;
}

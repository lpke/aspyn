import fs from "node:fs/promises";
import path from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import type { GlobalConfig, PipelineConfig, StepObject } from "../types/config.js";
import {
  DEFAULT_INTERVAL,
  DEFAULT_TIMEOUT_SECONDS,
  MIN_INTERVAL,
  SHUTDOWN_TIMEOUT_MS,
  LOG_LEVELS,
  MISSED_RUN_POLICIES,
  CONFIG_FILE,
} from "../constants.js";
import {
  configRoot,
  globalConfigPath,
  pipelineConfigPath,
} from "../paths.js";
import { resolveEnv } from "../template/resolve.js";

// ── JSONC parsing ───────────────────────────────────────────────────

function parseJsonc(text: string, filePath: string): unknown {
  const errors: ParseError[] = [];
  const result = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error(
      `Failed to parse JSONC at ${filePath}: ${errors.map((e) => `offset ${e.offset}: ${e.error}`).join(", ")}`,
    );
  }
  return result;
}

// ── Hook normalisation ──────────────────────────────────────────────

function isStepObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Find step objects referenced as onError hooks and strip their
 * `retry` and nested `onError` fields.
 */
function normaliseHooks(cfg: PipelineConfig): void {
  // Collect step names that are used as onError hooks
  const hookNames = new Set<string>();

  if (typeof cfg.onError === "string") {
    hookNames.add(cfg.onError);
  }

  for (const step of cfg.pipeline) {
    if (typeof step !== "string" && step.onError) {
      hookNames.add(step.onError);
    }
  }

  if (hookNames.size === 0) return;

  // Walk steps and strip retry/onError from any step whose name is a hook target
  for (let i = 0; i < cfg.pipeline.length; i++) {
    const step = cfg.pipeline[i];
    if (typeof step === "string") continue;
    if (hookNames.has(step.name)) {
      delete (step as unknown as Record<string, unknown>).retry;
      delete (step as unknown as Record<string, unknown>).onError;
    }
  }
}

// ── Public API ──────────────────────────────────────────────────────

export async function loadPipelineConfig(name: string): Promise<PipelineConfig> {
  const filePath = pipelineConfigPath(name);
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf-8");
  } catch (err: unknown) {
    throw new Error(
      `[${name}] Could not read config at ${filePath}: ${(err as Error).message}`,
    );
  }
  const raw = parseJsonc(text, filePath);
  const resolved = resolveEnv(raw) as PipelineConfig;
  normaliseHooks(resolved);
  return resolved;
}

export async function loadGlobalConfig(): Promise<GlobalConfig> {
  const filePath = globalConfigPath();
  let raw: Record<string, unknown>;
  try {
    const text = await fs.readFile(filePath, "utf-8");
    raw = parseJsonc(text, filePath) as Record<string, unknown>;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      raw = {};
    } else {
      throw err;
    }
  }

  const resolved = resolveEnv(raw) as Record<string, unknown>;

  return {
    defaultInterval: typeof resolved.defaultInterval === "string" ? resolved.defaultInterval : DEFAULT_INTERVAL,
    defaultTimeout: typeof resolved.defaultTimeout === "number" ? resolved.defaultTimeout : DEFAULT_TIMEOUT_SECONDS,
    minInterval: typeof resolved.minInterval === "string" ? resolved.minInterval : MIN_INTERVAL,
    shutdownTimeout: typeof resolved.shutdownTimeout === "number" ? resolved.shutdownTimeout : SHUTDOWN_TIMEOUT_MS,
    missedRunPolicy:
      typeof resolved.missedRunPolicy === "string" &&
      (MISSED_RUN_POLICIES as readonly string[]).includes(resolved.missedRunPolicy)
        ? (resolved.missedRunPolicy as GlobalConfig["missedRunPolicy"])
        : "run_once",
    log:
      typeof resolved.log === "string" &&
      (LOG_LEVELS as readonly string[]).includes(resolved.log)
        ? (resolved.log as GlobalConfig["log"])
        : "info",
    playwright: isStepObject(resolved.playwright) ? resolved.playwright as GlobalConfig["playwright"] : undefined,
    stateHistory: isStepObject(resolved.stateHistory)
      ? resolved.stateHistory as GlobalConfig["stateHistory"]
      : { enabled: true },
  };
}

export async function listPipelineNames(): Promise<string[]> {
  const root = configRoot();
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const candidate = path.join(root, entry.name, CONFIG_FILE);
    try {
      await fs.access(candidate);
      names.push(entry.name);
    } catch {
      // no config.jsonc — skip
    }
  }
  return names.sort();
}

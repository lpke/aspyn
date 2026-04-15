import fs from "node:fs/promises";
import path from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import type { GlobalConfig, WatchConfig } from "../types/config.js";
import {
  getConfigDir,
  getGlobalConfigPath,
  getWatchConfigPath,
} from "./paths.js";
import { validateGlobalConfig, validateWatchConfig } from "./validator.js";

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

export async function loadGlobalConfig(): Promise<GlobalConfig> {
  const filePath = getGlobalConfigPath();
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return validateGlobalConfig({});
    }
    throw err;
  }
  const raw = parseJsonc(text, filePath);
  return validateGlobalConfig(raw);
}

export async function loadWatchConfig(name: string): Promise<WatchConfig> {
  const filePath = getWatchConfigPath(name);
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf-8");
  } catch (err: unknown) {
    throw new Error(
      `[${name}] Could not read config at ${filePath}: ${(err as Error).message}`,
    );
  }
  const raw = parseJsonc(text, filePath);
  return validateWatchConfig(raw, name);
}

export async function discoverWatches(): Promise<string[]> {
  const configDir = getConfigDir();
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(configDir, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }

  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(configDir, entry.name, "config.jsonc");
    try {
      await fs.access(candidate);
      names.push(entry.name);
    } catch {
      // directory without config.jsonc — skip
    }
  }
  return names.sort();
}

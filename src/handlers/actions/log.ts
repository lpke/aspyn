import fs from "node:fs/promises";
import path from "node:path";
import type { LogActionInput } from "../../types/config.js";
import type { PipelineContext } from "../../types/pipeline.js";
import { getActionLogPath } from "../../config/paths.js";
import { rotateIfNeeded } from "../../logger.js";

export async function logAction(
  input: LogActionInput,
  context: PipelineContext,
  watchName: string,
  maxFileSize?: string,
  maxFiles?: number,
): Promise<void> {
  const logPath = getActionLogPath(watchName);
  await fs.mkdir(path.dirname(logPath), { recursive: true });

  await rotateIfNeeded(logPath, maxFileSize ?? "5mb", maxFiles ?? 5);

  const format = input.format ?? "json";
  let line: string;

  if (format === "json") {
    line = JSON.stringify({ timestamp: new Date().toISOString(), ...context }) + "\n";
  } else {
    const ts = new Date().toISOString();
    const entries = Object.entries(context.value)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");
    line = `${ts} changed=${context.changed} ${entries}\n`;
  }

  await fs.appendFile(logPath, line, "utf-8");
}

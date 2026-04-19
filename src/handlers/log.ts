import fss from "node:fs";
import path from "node:path";
import { register, type HandlerContext } from "./registry.js";
import { actionLogPath } from "../paths.js";
import { rotateIfNeededSync } from "../logger.js";
import { DEFAULT_ROTATION_MAX_FILE_SIZE, DEFAULT_ROTATION_MAX_FILES } from "../constants.js";
import type { LogLevel } from "../constants.js";

register({
  name: "log",
  sideEffectDefault: true,

  async run(ctx: HandlerContext, input: unknown): Promise<unknown> {
    const opts = input as {
      format?: "json" | "text";
      level?: LogLevel;
      message?: string;
    };

    const format = opts.format ?? "json";
    const logPath = actionLogPath(ctx.meta.pipeline);

    // Ensure directory exists
    fss.mkdirSync(path.dirname(logPath), { recursive: true });

    // Rotate if needed
    rotateIfNeededSync(logPath, DEFAULT_ROTATION_MAX_FILE_SIZE, DEFAULT_ROTATION_MAX_FILES);

    let line: string;
    if (format === "text" && opts.message !== undefined) {
      line = opts.message + "\n";
    } else {
      line = JSON.stringify(ctx.input) + "\n";
    }

    fss.appendFileSync(logPath, line, "utf-8");

    return { logged: true, path: logPath };
  },
});

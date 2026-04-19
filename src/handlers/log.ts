import fs from "node:fs/promises";
import fss from "node:fs";
import path from "node:path";
import { register, type HandlerContext } from "./registry.js";
import { actionLogPath } from "../paths.js";
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

    let line: string;
    if (format === "text" && opts.message !== undefined) {
      line = opts.message + "\n";
    } else {
      line = JSON.stringify(ctx.input) + "\n";
    }

    await fs.appendFile(logPath, line, "utf-8");

    return { logged: true, path: logPath };
  },
});

import { register, type HandlerContext } from "./registry.js";
import { execShell, parseJsonOutput } from "../execution/shell.js";
import { ENV_CONTEXT_FILE } from "../constants.js";
import { parseDurationMs } from "../duration.js";

register({
  name: "shell",
  sideEffectDefault: true,

  async run(ctx: HandlerContext, input: unknown): Promise<unknown> {
    const opts =
      typeof input === "string"
        ? { command: input }
        : (input as { command: string; timeout?: string | number });

    const env: Record<string, string> = {};
    const ctxFile = process.env[ENV_CONTEXT_FILE];
    if (ctxFile) {
      env[ENV_CONTEXT_FILE] = ctxFile;
    }

    const timeoutSecs = opts.timeout !== undefined
      ? parseDurationMs(opts.timeout) / 1000
      : undefined;

    const result = await execShell({
      command: opts.command,
      cwd: process.cwd(),
      stdin: JSON.stringify(ctx.input),
      timeout: timeoutSecs,
      env,
    });

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `shell exited with code ${result.exitCode}`);
    }

    return parseJsonOutput(result.stdout) ?? result.stdout.trim();
  },
});

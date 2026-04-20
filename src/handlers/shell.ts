import { register, type HandlerContext } from './registry.js';
import { execShell, parseJsonOutput } from '../execution/shell.js';
import { ENV_CONTEXT_FILE } from '../constants.js';
import { pipelineConfigDir } from '../paths.js';

register({
  name: 'shell',
  sideEffectDefault: true,

  async run(ctx: HandlerContext, input: unknown): Promise<unknown> {
    const opts =
      typeof input === 'string'
        ? { command: input }
        : (input as { command: string });

    const env: Record<string, string> = {};
    const ctxFile = (ctx as unknown as Record<string, unknown>).__contextFile;
    if (typeof ctxFile === 'string') {
      env[ENV_CONTEXT_FILE] = ctxFile;
    }

    const result = await execShell({
      command: opts.command,
      cwd: pipelineConfigDir(ctx.meta.pipeline),
      stdin: JSON.stringify(ctx.input),
      signal: ctx.signal,
      env,
    });

    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr || `shell exited with code ${result.exitCode}`,
      );
    }

    return parseJsonOutput(result.stdout) ?? result.stdout.trim();
  },
});

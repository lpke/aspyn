import type { ShellActionInput } from "../../types/config.js";
import type { PipelineContext } from "../../types/pipeline.js";
import { execShell } from "../../execution/shell.js";

export async function shellAction(
  input: ShellActionInput,
  context: PipelineContext,
  cwd: string,
  defaultTimeout: number,
): Promise<void> {
  const result = await execShell({
    command: input.command,
    cwd,
    stdin: JSON.stringify(context),
    timeout: input.timeout ?? defaultTimeout,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Shell action exited with code ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
}

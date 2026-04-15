import { execShell } from "../../execution/shell.js";
import type { ShellSourceInput } from "../../types/config.js";
import type { StepOutput } from "../../types/pipeline.js";

export async function shellSource(
  input: ShellSourceInput,
  cwd: string,
  timeout: number,
): Promise<StepOutput> {
  const effectiveTimeout = input.timeout ?? timeout;

  const result = await execShell({
    command: input.command,
    cwd,
    timeout: effectiveTimeout,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Shell source failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
    );
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

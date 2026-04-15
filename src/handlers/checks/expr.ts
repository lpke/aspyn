import type { PipelineContext } from "../../types/pipeline.js";

export function exprCheck(expression: string, context: PipelineContext): boolean {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      "value",
      "prev",
      "changed",
      "firstRun",
      "meta",
      `return (${expression});`,
    );
    const result: unknown = fn(
      context.value,
      context.prev,
      context.changed,
      context.firstRun,
      context.meta,
    );
    return Boolean(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Expression check failed for "${expression}": ${msg}`);
  }
}

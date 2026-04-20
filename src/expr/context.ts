import type { PipelineContext } from '../types/pipeline.js';

/**
 * Build the context object passed to jexl expressions.
 * Shared by the pipeline engine and the expr handler.
 */
export function buildExprContext(ctx: PipelineContext): Record<string, unknown> {
  return {
    input: ctx.input,
    steps: ctx.steps,
    prev: ctx.prev,
    firstRun: ctx.firstRun,
    meta: ctx.meta,
    changed: ctx.changed,
    __failed: (ctx as unknown as Record<string, unknown>).__failed,
    __error: (ctx as unknown as Record<string, unknown>).__error,
  };
}

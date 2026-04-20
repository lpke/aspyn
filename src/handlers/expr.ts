import { createEngine, type ExprEngine } from '../expr/engine.js';
import { register, type HandlerContext } from './registry.js';

function exprContext(ctx: HandlerContext): Record<string, unknown> {
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

register({
  name: 'expr',
  async run(ctx: HandlerContext, input: unknown) {
    const { expression } = input as { expression: string };
    const engine: ExprEngine = (ctx as unknown as Record<string, unknown>).__engine as ExprEngine
      ?? createEngine();
    const result = await engine.evaluate(expression, exprContext(ctx));
    return result;
  },
});

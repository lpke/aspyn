import { createEngine, type ExprEngine } from '../expr/engine.js';
import { buildExprContext } from '../expr/context.js';
import { register, type HandlerContext } from './registry.js';

register({
  name: 'expr',
  async run(ctx: HandlerContext, input: unknown) {
    const { expression } = input as { expression: string };
    const engine: ExprEngine = (ctx as unknown as Record<string, unknown>).__engine as ExprEngine
      ?? createEngine();
    const result = await engine.evaluate(expression, buildExprContext(ctx));
    return result;
  },
});

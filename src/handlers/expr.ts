import { createEngine } from "../expr/engine.js";
import { register, type HandlerContext } from "./registry.js";

const engine = createEngine();

function exprContext(ctx: HandlerContext): Record<string, unknown> {
  return {
    input: ctx.input,
    steps: ctx.steps,
    prev: ctx.prev,
    firstRun: ctx.firstRun,
    meta: ctx.meta,
    __changedMap: ctx.__changedMap,
    __failed: (ctx as unknown as Record<string, unknown>).__failed ?? null,
    __error: (ctx as unknown as Record<string, unknown>).__error ?? null,
  };
}

register({
  name: "expr",
  async run(ctx: HandlerContext, input: unknown) {
    const { expression } = input as { expression: string };
    const result = await engine.evaluate(expression, exprContext(ctx));
    return result;
  },
});

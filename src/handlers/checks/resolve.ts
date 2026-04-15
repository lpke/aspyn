import type { TypedCheckHandler } from "../../types/config.js";
import type { PipelineContext } from "../../types/pipeline.js";
import { exprCheck } from "./expr.js";

export function resolveCheck(
  handler: TypedCheckHandler,
  context: PipelineContext,
): boolean {
  switch (handler.type) {
    case "expr":
      return exprCheck(handler.input.expression, context);
    default: {
      const exhaustive: never = handler.type;
      throw new Error(
        `Unknown check type: ${exhaustive as string}`,
      );
    }
  }
}

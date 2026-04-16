import type { TypedCheckHandler } from "../../types/config.js";
import type { PipelineContext } from "../../types/pipeline.js";
import type { Logger } from "../../logger.js";
import { logger as globalLogger } from "../../logger.js";
import { exprCheck } from "./expr.js";

export function resolveCheck(
  handler: TypedCheckHandler,
  context: PipelineContext,
  log?: Logger,
): boolean {
  const logger = log ?? globalLogger;
  switch (handler.type) {
    case "expr":
      return exprCheck(handler.input.expression, context, logger);
    default: {
      const exhaustive: never = handler.type;
      throw new Error(
        `Unknown check type: ${exhaustive as string}`,
      );
    }
  }
}

import type { TypedParseHandler } from "../../types/config.js";
import type { StepOutput } from "../../types/pipeline.js";
import type { Logger } from "../../logger.js";
import { logger as globalLogger } from "../../logger.js";
import { selectorParse } from "./selector.js";
import { jsonParse } from "./json.js";
import { regexParse } from "./regex.js";

export async function resolveParse(
  handler: TypedParseHandler,
  data: StepOutput,
  log?: Logger,
): Promise<StepOutput> {
  const logger = log ?? globalLogger;
  switch (handler.type) {
    case "selector":
      return selectorParse(handler.input, data, logger);
    case "json":
      return jsonParse(handler.input, data, logger);
    case "regex":
      return regexParse(handler.input, data, logger);
    default: {
      const exhaustive: never = handler;
      throw new Error(
        `Unknown parse type: ${(exhaustive as TypedParseHandler).type}`,
      );
    }
  }
}

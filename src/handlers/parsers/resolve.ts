import type { TypedParseHandler } from "../../types/config.js";
import type { StepOutput } from "../../types/pipeline.js";
import { selectorParse } from "./selector.js";
import { jsonParse } from "./json.js";
import { regexParse } from "./regex.js";

export async function resolveParse(
  handler: TypedParseHandler,
  data: StepOutput,
): Promise<StepOutput> {
  switch (handler.type) {
    case "selector":
      return selectorParse(handler.input, data);
    case "json":
      return jsonParse(handler.input, data);
    case "regex":
      return regexParse(handler.input, data);
    default: {
      const exhaustive: never = handler;
      throw new Error(
        `Unknown parse type: ${(exhaustive as TypedParseHandler).type}`,
      );
    }
  }
}

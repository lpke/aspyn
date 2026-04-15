import { JSONPath } from "jsonpath-plus";
import type { JsonParseInput } from "../../types/config.js";
import type { StepOutput } from "../../types/pipeline.js";

export async function jsonParse(
  input: JsonParseInput,
  data: StepOutput,
): Promise<StepOutput> {
  const target =
    data.body !== undefined && typeof data.body === "object" && data.body !== null
      ? data.body
      : data;

  const result: StepOutput = {};

  for (const [key, query] of Object.entries(input.queries)) {
    const matches: unknown[] = JSONPath({ path: query, json: target });
    if (matches.length === 0) {
      result[key] = null;
    } else if (matches.length === 1) {
      result[key] = matches[0];
    } else {
      result[key] = matches;
    }
  }

  return result;
}

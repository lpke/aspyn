import type { RegexParseInput } from "../../types/config.js";
import type { StepOutput } from "../../types/pipeline.js";
import type { Logger } from "../../logger.js";

export async function regexParse(
  input: RegexParseInput,
  data: StepOutput,
  _log?: Logger,
): Promise<StepOutput> {
  let source: string | undefined;

  if (input.source !== undefined) {
    const val = data[input.source];
    if (typeof val === "string") source = val;
  } else {
    for (const key of ["body", "content", "stdout"] as const) {
      if (typeof data[key] === "string") {
        source = data[key] as string;
        break;
      }
    }
  }

  if (source === undefined) {
    throw new Error("regexParse: no source text found in data");
  }

  const result: StepOutput = {};

  for (const [key, pattern] of Object.entries(input.patterns)) {
    const re = new RegExp(pattern);
    const match = re.exec(source);
    if (!match) {
      result[key] = null;
    } else {
      result[key] = match[1] ?? match[0];
    }
  }

  return result;
}

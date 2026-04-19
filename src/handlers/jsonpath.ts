// Keeping jsonpath-plus (already in package.json). It covers most JSONPath
// needs and avoids adding a new dependency.
import { JSONPath } from "jsonpath-plus";
import { register, type HandlerContext } from "./registry.js";

register({
  name: "jsonpath",
  async run(ctx: HandlerContext, input: unknown) {
    const { queries } = input as { queries: Record<string, string> };

    // data is the object JSONPath queries run against
    const source = ctx.input;
    const data =
      source && typeof source === "object" && source !== null
        && "body" in source && source.body !== null && typeof source.body === "object"
          ? source.body
          : source;

    if (data === undefined || data === null) {
      throw new Error("jsonpath: ctx.input is empty; nothing to query");
    }

    const result: Record<string, unknown> = {};

    for (const [key, query] of Object.entries(queries)) {
      const matches: unknown[] = JSONPath({ path: query, json: data });
      if (matches.length === 0) {
        result[key] = null;
      } else if (matches.length === 1) {
        result[key] = matches[0];
      } else {
        result[key] = matches;
      }
    }

    return result;
  },
});

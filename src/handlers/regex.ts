import { register, type HandlerContext } from "./registry.js";

register({
  name: "regex",
  async run(ctx: HandlerContext, input: unknown) {
    const { patterns, source: sourceKey } = input as {
      patterns: Record<string, string>;
      source?: string;
    };

    const data = ctx.resolvedInput as Record<string, unknown>;
    let source: string | undefined;

    if (sourceKey !== undefined) {
      const val = (data as Record<string, unknown>)[sourceKey];
      if (typeof val === "string") source = val;
    } else {
      for (const key of ["body", "content", "stdout"] as const) {
        if (typeof (data as Record<string, unknown>)[key] === "string") {
          source = (data as Record<string, unknown>)[key] as string;
          break;
        }
      }
    }

    if (source === undefined) {
      throw new Error("regex: no source text found in input");
    }

    const result: Record<string, string | null> = {};

    for (const [key, pattern] of Object.entries(patterns)) {
      const re = new RegExp(pattern);
      const match = re.exec(source);
      if (!match) {
        result[key] = null;
      } else {
        result[key] = match[1] ?? match[0];
      }
    }

    return result;
  },
});

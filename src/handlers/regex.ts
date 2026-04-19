import { register, type HandlerContext } from "./registry.js";

register({
  name: "regex",
  async run(ctx: HandlerContext, input: unknown) {
    const { patterns, source: sourceKey } = input as {
      patterns: Record<string, string | { pattern: string; flags?: string }>;
      source?: string;
    };

    const raw = ctx.input;
    let source: string | undefined;

    if (typeof raw === "string") {
      source = raw;
    } else if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      const data = raw as Record<string, unknown>;
      if (sourceKey !== undefined) {
        const val = data[sourceKey];
        if (typeof val === "string") source = val;
      } else {
        for (const key of ["body", "content", "stdout"] as const) {
          const val = data[key];
          if (typeof val === "string") { source = val; break; }
        }
      }
    }

    if (source === undefined) {
      throw new Error("regex: no source text found in input");
    }

    const result: Record<string, string | null> = {};

    for (const [key, entry] of Object.entries(patterns)) {
      const re = typeof entry === "string"
        ? new RegExp(entry)
        : new RegExp(entry.pattern, entry.flags);
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

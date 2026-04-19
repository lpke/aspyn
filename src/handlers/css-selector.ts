import { load, type CheerioAPI } from "cheerio";
import { register, type HandlerContext } from "./registry.js";

const PSEUDO_RE = /::(text|html|attr\([^)]+\))$/;

function parsePseudo(raw: string): { selector: string; pseudo: string | null } {
  const match = raw.match(PSEUDO_RE);
  if (!match) return { selector: raw, pseudo: null };
  return { selector: raw.slice(0, match.index!), pseudo: match[1] };
}

function extract($: CheerioAPI, selector: string, pseudo: string | null): string | null {
  const $el = $(selector).first();
  if (!$el.length) return null;
  if (!pseudo || pseudo === "text") return $el.text();
  if (pseudo === "html") return $el.html();
  const attrMatch = pseudo.match(/^attr\((.+)\)$/);
  if (attrMatch) return $el.attr(attrMatch[1]) ?? null;
  return $el.text();
}

register({
  name: "css-selector",
  async run(ctx: HandlerContext, input: unknown) {
    const { selectors } = input as { selectors: Record<string, string> };

    const data = ctx.resolvedInput as Record<string, unknown> | string;
    const html =
      typeof data === "string"
        ? data
        : typeof (data as Record<string, unknown>).html === "string"
          ? (data as Record<string, unknown>).html as string
          : undefined;

    if (html === undefined) {
      throw new Error("css-selector: no HTML string found in input (checked html, string)");
    }

    const $ = load(html);
    const result: Record<string, string | null> = {};

    for (const [key, raw] of Object.entries(selectors)) {
      const { selector, pseudo } = parsePseudo(raw);
      result[key] = extract($, selector, pseudo);
    }

    return result;
  },
});

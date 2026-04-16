import { load, type CheerioAPI } from "cheerio";
import type { SelectorParseInput } from "../../types/config.js";
import type { StepOutput } from "../../types/pipeline.js";

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
import type { Logger } from "../../logger.js";

export async function selectorParse(
  input: SelectorParseInput,
  data: StepOutput,
  _log?: Logger,
): Promise<StepOutput> {
  const html =
    typeof data.html === "string"
      ? data.html
      : typeof data.body === "string"
        ? data.body
        : typeof data.content === "string"
          ? data.content
          : undefined;

  if (html === undefined) {
    throw new Error("selectorParse: no HTML string found in data (checked html, body, content)");
  }

  const $ = load(html);
  const result: StepOutput = {};

  for (const [key, raw] of Object.entries(input.selectors)) {
    const { selector, pseudo } = parsePseudo(raw);
    result[key] = extract($, selector, pseudo);
  }

  return result;
}

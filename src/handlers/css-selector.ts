import { load, type CheerioAPI } from 'cheerio';
import { register, type HandlerContext } from './registry.js';

const PSEUDO_RE = /::(text|html|attr\([^)]+\)|\S+)$/;

const ALLOWED_PSEUDOS = new Set([
  // pseudo-elements
  '::before',
  '::after',
  '::first-line',
  '::first-letter',
  '::marker',
  '::placeholder',
  '::selection',
  '::backdrop',
  // safe pseudo-classes
  ':root',
  ':scope',
  ':first-child',
  ':last-child',
  ':only-child',
  ':nth-child',
  ':first-of-type',
  ':last-of-type',
  ':only-of-type',
  ':nth-of-type',
  ':empty',
  ':not',
]);

/** Extract the head of a pseudo token (before any parenthesised arg). */
function pseudoHead(token: string): string {
  const parenIdx = token.indexOf('(');
  return parenIdx === -1 ? token : token.slice(0, parenIdx);
}

/** Check that every `:` / `::` pseudo in a selector is on the allow-list. */
function validatePseudos(selector: string): void {
  // Match :foo or ::foo (possibly with parens)
  const re = /::?[A-Za-z][\w-]*(\([^)]*\))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(selector)) !== null) {
    const head = pseudoHead(m[0]);
    if (!ALLOWED_PSEUDOS.has(head)) {
      throw new Error(
        `css-selector: unsupported pseudo "${m[0]}" in "${selector}". ` +
          `Allowed pseudos: ${[...ALLOWED_PSEUDOS].join(', ')}`,
      );
    }
  }
}

function parsePseudo(raw: string): { selector: string; pseudo: string | null } {
  const match = raw.match(PSEUDO_RE);
  if (!match) {
    validatePseudos(raw);
    return { selector: raw, pseudo: null };
  }
  const pseudo = match[1];
  if (pseudo !== 'text' && pseudo !== 'html' && !pseudo.startsWith('attr(')) {
    throw new Error(`css-selector: unknown pseudo "::${pseudo}" in "${raw}"`);
  }
  // Validate remaining selector portion for CSS pseudos
  const selectorPart = raw.slice(0, match.index!);
  validatePseudos(selectorPart);
  return { selector: selectorPart, pseudo };
}

function extract(
  $: CheerioAPI,
  selector: string,
  pseudo: string | null,
): string | null {
  const $el = $(selector).first();
  if (!$el.length) return null;
  if (!pseudo || pseudo === 'text') return $el.text();
  if (pseudo === 'html') return $el.html();
  const attrMatch = pseudo.match(/^attr\((.+)\)$/);
  if (attrMatch) return $el.attr(attrMatch[1]) ?? null;
  throw new Error(
    `css-selector: unknown pseudo "::${pseudo}" in "${selector}::${pseudo}"`,
  );
}

register({
  name: 'css-selector',
  async run(ctx: HandlerContext, input: unknown) {
    const { selectors } = input as { selectors: Record<string, string> };

    const raw = ctx.input;
    let html: string | undefined;
    if (typeof raw === 'string') {
      html = raw;
    } else if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      const maybe = (raw as Record<string, unknown>).html;
      if (typeof maybe === 'string') html = maybe;
    }

    if (html === undefined) {
      throw new Error(
        'css-selector: no HTML string found in input (checked html, string)',
      );
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

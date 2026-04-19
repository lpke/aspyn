import type { ExprEngine } from "../expr/engine.js";

// ---------------------------------------------------------------------------
// Pattern helpers
// ---------------------------------------------------------------------------

/** Matches `$VAR` or `${VAR}` where VAR is a simple identifier (env-style). */
const ENV_BARE = /(?<!\\)\$([A-Za-z_][A-Za-z0-9_]*)/g;
const ENV_BRACE = /(?<!\\)\$\{([A-Za-z_][A-Za-z0-9_]*)}/g;

/** Quick check: does the string contain any `${…}` template? */
export function hasTemplate(str: string): boolean {
  return str.includes("${");
}

// ---------------------------------------------------------------------------
// Tree walker
// ---------------------------------------------------------------------------

type Mapper = (s: string) => string | Promise<string>;

function walkSync(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => walkSync(v, fn));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walkSync(v, fn);
    }
    return out;
  }
  return value;
}

async function walkAsync(value: unknown, fn: (s: string) => Promise<unknown>): Promise<unknown> {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return Promise.all(value.map((v) => walkAsync(v, fn)));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = await walkAsync(v, fn);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// resolveEnv — config-load time
// ---------------------------------------------------------------------------

export function resolveEnv(value: unknown): unknown {
	return walkSync(value, (s) => {
		// Replace ${VAR} first (greedy identifier only)
		let result = s.replace(ENV_BRACE, (match, name: string) =>
			process.env[name] !== undefined ? process.env[name]! : match
		);
		// Replace bare $VAR
		result = result.replace(ENV_BARE, (match, name: string) =>
			process.env[name] !== undefined ? process.env[name]! : match
		);
		// Replace escaped \$ with literal $
		result = result.replace(/\\\$/g, "$");
		return result;
	});
}

// ---------------------------------------------------------------------------
// resolveRuntime — step-execution time
// ---------------------------------------------------------------------------

/**
 * Find the innermost `${...}` expression (no nested `${` inside).
 * Returns [fullMatch, expr, startIndex] or null.
 */
function findInnermost(s: string): { start: number; end: number; expr: string } | null {
  // Scan for `${` — pick the last `${` before the first `}` that closes it.
  let i = 0;
  while (i < s.length) {
    const openIdx = s.indexOf("${", i);
    if (openIdx === -1) return null;

    // Find the matching `}`, but if we hit another `${` first, restart from there.
    let j = openIdx + 2;
    let innerOpen = openIdx;
    while (j < s.length) {
      if (s[j] === "}" ) {
        // `innerOpen` is the last `${` before this `}`
        const expr = s.slice(innerOpen + 2, j);
        return { start: innerOpen, end: j + 1, expr };
      }
      if (s[j] === "$" && j + 1 < s.length && s[j + 1] === "{") {
        innerOpen = j;
        j += 2;
        continue;
      }
      j++;
    }
    // No closing brace found for this `${`
    break;
  }
  return null;
}

async function resolveString(
  s: string,
  engine: ExprEngine,
  ctx: Record<string, unknown>,
): Promise<unknown> {
  // Whole-string single-template case: preserve the evaluated type.
  const first = findInnermost(s);
  if (first && first.start === 0 && first.end === s.length) {
    const evaluated = await engine.evaluate(first.expr.trim(), ctx);
    return evaluated;
  }

  // Multi-template / embedded: resolve innermost ${...} repeatedly, stringify.
  let result = s;
  const maxIterations = 64; // safety cap
  for (let iter = 0; iter < maxIterations; iter++) {
    const match = findInnermost(result);
    if (!match) break;

    const evaluated = await engine.evaluate(match.expr.trim(), ctx);

    const replacement = evaluated === undefined || evaluated === null ? "" : String(evaluated);
    result = result.slice(0, match.start) + replacement + result.slice(match.end);
  }
  return result;
}

export async function resolveRuntime(
  value: unknown,
  engine: ExprEngine,
  ctx: Record<string, unknown>,
): Promise<unknown> {
  return walkAsync(value, (s) => resolveString(s, engine, ctx));
}

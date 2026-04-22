import { JSONPath } from 'jsonpath-plus';
import { register, type HandlerContext } from './registry.js';

/**
 * Resolve the query target from ctx.input.
 *
 * When input is an object with a known envelope key (body, content, stdout),
 * unwrap to that field — consistent with how the regex handler resolves its
 * source. This means http's { status, headers, body } is automatically
 * unwrapped to `body` for querying.
 *
 * If the envelope value is a JSON string, parse it first.
 */
function resolveData(input: unknown): unknown {
  if (input === null || input === undefined) {
    throw new Error('jsonpath: ctx.input is empty; nothing to query');
  }

  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch {
      throw new Error('jsonpath: ctx.input is a non-JSON string; cannot query');
    }
  }

  if (Array.isArray(input)) {
    return input;
  }

  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    for (const key of ['body', 'content', 'stdout']) {
      if (key in obj && obj[key] !== undefined && obj[key] !== null) {
        const val = obj[key];
        if (typeof val === 'string') {
          try {
            return JSON.parse(val);
          } catch {
            return val;
          }
        }
        return val;
      }
    }
  }

  return input;
}

register({
  name: 'jsonpath',
  async run(ctx: HandlerContext, input: unknown) {
    const { queries } = input as { queries: Record<string, string> };

    const data = resolveData(ctx.input);

    const result: Record<string, unknown> = {};

    for (const [key, query] of Object.entries(queries)) {
      // Handle .length suffix: query the parent path, return array length
      if (query.endsWith('.length')) {
        const parentPath = query.slice(0, -'.length'.length);
        const matches: unknown[] = JSONPath({ path: parentPath, json: data as object });
        if (matches.length === 0) {
          result[key] = null;
        } else {
          const target = matches.length === 1 ? matches[0] : matches;
          result[key] = Array.isArray(target) ? target.length : null;
        }
        continue;
      }

      const matches: unknown[] = JSONPath({ path: query, json: data as object });
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

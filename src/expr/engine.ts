import jexlDefault from 'jexl';
const Jexl = (jexlDefault as unknown as { Jexl: new () => typeof jexlDefault })
  .Jexl;
import { isDeepStrictEqual } from 'node:util';

export interface ExprEngine {
  evaluate(expression: string, ctx: Record<string, unknown>): Promise<unknown>;
  evaluateSync(expression: string, ctx: Record<string, unknown>): unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function helperGet(
  obj: unknown,
  path: string,
  defaultValue?: unknown,
): unknown {
  if (obj == null || typeof path !== 'string') return defaultValue;
  const keys = path.replace(/\[(\d+)]/g, '.$1').split('.');
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return defaultValue;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur === undefined ? defaultValue : cur;
}

function helperHas(obj: unknown, path: string): boolean {
  if (obj == null || typeof path !== 'string') return false;
  const keys = path.replace(/\[(\d+)]/g, '.$1').split('.');
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return false;
    if (!(k in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[k];
  }
  return true;
}

function helperLen(x: unknown): number {
  if (typeof x === 'string' || Array.isArray(x)) return x.length;
  if (x != null && typeof x === 'object') return Object.keys(x).length;
  return 0;
}

function helperContains(haystack: unknown, needle: unknown): boolean {
  if (typeof haystack === 'string' && typeof needle === 'string')
    return haystack.includes(needle);
  if (Array.isArray(haystack)) return haystack.includes(needle);
  return false;
}

function helperMatches(str: unknown, regex: unknown): boolean {
  if (typeof str !== 'string' || typeof regex !== 'string') return false;
  return new RegExp(regex).test(str);
}

function helperSince(ts: unknown, unit?: unknown): number {
  if (typeof ts !== 'string') return NaN;
  const diffMs = Date.now() - new Date(ts).getTime();
  const diffS = diffMs / 1000;
  switch (unit) {
    case 'minutes':
      return diffS / 60;
    case 'hours':
      return diffS / 3600;
    default:
      return diffS;
  }
}

function helperCoalesce(...args: unknown[]): unknown {
  for (const a of args) {
    if (a !== null && a !== undefined) return a;
  }
  return undefined;
}

function helperPick(obj: unknown, keys: unknown): Record<string, unknown> {
  if (obj == null || typeof obj !== 'object') {
    throw new TypeError('pick: first argument must be an object');
  }
  if (!Array.isArray(keys)) {
    throw new TypeError('pick: second argument must be an array of keys');
  }
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (typeof k === 'string' && k in (obj as Record<string, unknown>)) {
      out[k] = (obj as Record<string, unknown>)[k];
    }
  }
  return out;
}

function helperOmit(obj: unknown, keys: unknown): Record<string, unknown> {
  if (obj == null || typeof obj !== 'object') {
    throw new TypeError('omit: first argument must be an object');
  }
  if (!Array.isArray(keys)) {
    throw new TypeError('omit: second argument must be an array of keys');
  }
  const set = new Set(keys as string[]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (!set.has(k)) out[k] = v;
  }
  return out;
}

function helperThrow(msg: unknown): never {
  throw new Error(typeof msg === 'string' ? msg : String(msg));
}

// ---------------------------------------------------------------------------
// Engine factory
// ---------------------------------------------------------------------------

export function createEngine(): ExprEngine {
  const jexl = new Jexl();

  // Mutable ref updated by prepareCtx before each eval so the jexl function
  // (registered once via addFunction) always sees the current changed map.
  let currentChangedMap: Record<string, boolean> = {};

  jexl.addFunction('changed', (name?: string): boolean => {
    if (name === undefined)
      return Object.values(currentChangedMap).some(Boolean);
    return !!currentChangedMap[name];
  });

  // Register functions
  jexl.addFunction('deepEqual', (a: unknown, b: unknown) =>
    isDeepStrictEqual(a, b),
  );
  jexl.addFunction('get', (obj: unknown, path: string, def?: unknown) =>
    helperGet(obj, path, def),
  );
  jexl.addFunction('has', (obj: unknown, path: string) => helperHas(obj, path));
  jexl.addFunction('len', (x: unknown) => helperLen(x));
  jexl.addFunction('contains', (haystack: unknown, needle: unknown) =>
    helperContains(haystack, needle),
  );
  jexl.addFunction('matches', (str: unknown, regex: unknown) =>
    helperMatches(str, regex),
  );
  jexl.addFunction('since', (ts: unknown, unit?: unknown) =>
    helperSince(ts, unit),
  );
  jexl.addFunction('coalesce', (...args: unknown[]) => helperCoalesce(...args));
  jexl.addFunction('pick', (obj: unknown, keys: unknown) =>
    helperPick(obj, keys),
  );
  jexl.addFunction('omit', (obj: unknown, keys: unknown) =>
    helperOmit(obj, keys),
  );
  jexl.addFunction('throw', (msg: unknown) => helperThrow(msg));

  // Register transforms (pipe-style: value|transform(args))
  jexl.addTransform('len', (x: unknown) => helperLen(x));
  jexl.addTransform('contains', (haystack: unknown, needle: unknown) =>
    helperContains(haystack, needle),
  );
  jexl.addTransform('matches', (str: unknown, regex: unknown) =>
    helperMatches(str, regex),
  );
  jexl.addTransform('pick', (obj: unknown, keys: unknown) =>
    helperPick(obj, keys),
  );
  jexl.addTransform('omit', (obj: unknown, keys: unknown) =>
    helperOmit(obj, keys),
  );
  jexl.addTransform('get', (obj: unknown, path: string, def?: unknown) =>
    helperGet(obj, path, def),
  );
  jexl.addTransform('has', (obj: unknown, path: string) =>
    helperHas(obj, path),
  );

  function prepareCtx(ctx: Record<string, unknown>): Record<string, unknown> {
    const map = (ctx.changed as Record<string, boolean> | undefined) ?? {};
    // Update the closure ref so the jexl-registered changed() sees current map
    currentChangedMap = map;
    const prepared = { ...ctx };
    // Expose `changed` as a plain object keyed by step name → boolean
    prepared.changed = { ...map };
    // Expose `anyChanged` as a boolean
    prepared.anyChanged = Object.values(map).some(Boolean);
    return prepared;
  }

  return {
    evaluate(
      expression: string,
      ctx: Record<string, unknown>,
    ): Promise<unknown> {
      return jexl.eval(expression, prepareCtx(ctx));
    },
    evaluateSync(expression: string, ctx: Record<string, unknown>): unknown {
      return jexl.evalSync(expression, prepareCtx(ctx));
    },
  };
}

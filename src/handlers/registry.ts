import type { PipelineContext } from '../types/pipeline.js';

// ── Types ───────────────────────────────────────────────────────────

export type HandlerContext = PipelineContext & { signal: AbortSignal };

export interface Handler {
  name: string;
  sideEffectDefault?: boolean;
  run(ctx: HandlerContext, input: unknown): Promise<unknown>;
  /**
   * Called after a step failure to check whether the error was caused by a
   * missing external dependency.  Return an install hint string to surface to
   * the user, or `undefined` if the error is unrelated to missing deps.
   */
  dependencyHint?(errorMessage: string): string | undefined;
}

// ── Registry ────────────────────────────────────────────────────────

const registry: Map<string, Handler> = new Map();

export function register(h: Handler): void {
  registry.set(h.name, h);
}

export function lookup(name: string): Handler | undefined {
  return registry.get(name);
}

export function allHandlerNames(): string[] {
  return [...registry.keys()];
}

import type { PipelineContext } from "../types/pipeline.js";

// ── Types ───────────────────────────────────────────────────────────

export interface HandlerContext extends PipelineContext {
  resolvedInput: unknown;
}

export interface Handler {
  name: string;
  sideEffectDefault?: boolean;
  run(ctx: HandlerContext, input: unknown): Promise<unknown>;
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

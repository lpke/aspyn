import type { PipelineContext } from "../types/pipeline.js";

// ── Dot-path resolver ───────────────────────────────────────────────

function resolvePath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

// ── Template regex ──────────────────────────────────────────────────

const ENV_RE = /\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/g;
const TEMPLATE_RE = /\b(value|prev|meta)\.([\w.]+)/g;

// ── String expansion ────────────────────────────────────────────────

function expandString(str: string, context: PipelineContext): string {
  // Split the string into segments: alternating between original text
  // (which needs template expansion) and resolved env var values
  // (which must be treated as opaque/final).
  const segments: string[] = [];
  const isEnvSegment: boolean[] = [];
  let lastIndex = 0;

  // Reset regex state
  ENV_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ENV_RE.exec(str)) !== null) {
    // Push the literal text before this env var match
    if (match.index > lastIndex) {
      segments.push(str.slice(lastIndex, match.index));
      isEnvSegment.push(false);
    }
    // Push the resolved env var value (opaque — no further expansion)
    const name = match[1] ?? match[2]!;
    segments.push(process.env[name] ?? "");
    isEnvSegment.push(true);
    lastIndex = ENV_RE.lastIndex;
  }

  // Push any remaining literal text after the last env var
  if (lastIndex < str.length) {
    segments.push(str.slice(lastIndex));
    isEnvSegment.push(false);
  }

  // Run template expansion only on non-env segments, then rejoin
  return segments
    .map((seg, i) =>
      isEnvSegment[i]
        ? seg
        : seg.replace(TEMPLATE_RE, (original, root: string, dotPath: string) => {
            const source = context[root as "value" | "prev" | "meta"];
            if (source === null || source === undefined) return original;
            const resolved = resolvePath(source, dotPath);
            return resolved !== undefined ? String(resolved) : original;
          })
    )
    .join("");
}

// ── Recursive template expansion ────────────────────────────────────

export function expandTemplates(obj: unknown, context: PipelineContext): unknown {
  if (typeof obj === "string") return expandString(obj, context);
  if (Array.isArray(obj)) return obj.map((item) => expandTemplates(item, context));
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = expandTemplates(val, context);
    }
    return result;
  }
  return obj;
}

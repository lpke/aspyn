# aspyn

A local-first CLI for scriptable, config-driven pipelines. Pipelines are defined as JSONC configs under `~/.config/aspyn/<name>/config.jsonc` and executed as a generic sequence of named steps.

## Conventions

- **Project under active delevlopment.** Breaking changes are expected by end users. No extra effort needs to be made to avoid them.
- **No barrel files.** Never create `index.ts` re-export files. Import directly from the file that defines what you need (e.g. `import type { PipelineConfig } from "./types/config.js"`).
- **File extensions in imports.** Always use `.js` extensions in import paths (TypeScript + NodeNext).
- **Types live in `src/types/`.** Pure type definitions — no runtime code. Runtime must not live inside `src/types/`.
- **One concern per file.** Handlers, utilities, engine pieces, and CLI commands each get their own file.
- **No schema libraries.** Validation is hand-rolled and imperative (see `src/config/validator.ts` once it exists).
- **Shell execution only through `src/execution/shell.ts`.** Never call `child_process` anywhere else.
- **State writes are atomic** (write tmp + rename) for `state.json`. Append-only files (`state-history.jsonl`, `run.lock.jsonl`) use synchronous appends so short-lived CLI processes flush on exit.
- **Logging**: `src/logger.ts` for stderr. CLI user-facing stdout goes through `src/output.ts` helpers. No raw `console.*` outside the CLI entry point.
- **Paths**: all filesystem paths come from `src/paths.ts` (XDG-aware). No ad-hoc path composition elsewhere.
- **Constants**: all magic strings and numbers live in `src/constants.ts`. Do not inline literals that belong there. Module-local `constants.ts` files are allowed when scope is tight.
- **Handler registration**: every handler registers itself with the registry in `src/handlers/registry.ts`. The registry is the only way the engine resolves step `type` values.
- **Expressions and templates**: all `${...}` template resolution and `when:` / `expr` evaluation goes through the jexl-based engine at `src/expr/engine.ts`. Never roll an ad-hoc evaluator.
- **Concurrency and crash recovery**: the concurrency PID lock (`src/state/lock.ts`) is separate from the per-run journal (`src/state/journal.ts`). Do not conflate them.
- **Commit messages**: when asked to produce a commit message, keep the title brief, body as condensed high-level bullet points, one blank line between title and body, no special formatting — ready to copy verbatim.

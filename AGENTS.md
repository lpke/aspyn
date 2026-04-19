# aspyn

A local-first CLI for scriptable, config-driven pipelines. Pipelines are defined as JSONC configs under `~/.config/aspyn/<name>/config.jsonc` and executed as a generic sequence of named steps.

> **v2 in progress.** This branch is a WIP rewrite and is not runnable end-to-end until the Phase 20 cutover. The conventions below describe the target v2 architecture — some referenced files may not exist yet. **Only create files and imports that your current prompt asks for.** Do not create, import from, or reference files that have not been built yet.

## Working in phases

The v2 upgrade is delivered as a linear sequence of numbered phases (Phase 1 → Phase 23). Each invocation of you, the IDE agent, is scoped to **exactly one phase** — either a main phase (`Phase N`) or a **supplemental phase** that fixes or refines a recently-completed main phase (`Phase N.5`, `Phase N.6`, etc). The user drives the process by pasting that phase's prompt into this chat; everything you need for that phase is in the prompt itself.

How to orient yourself at the start of each phase:

- **The prompt you just received is the whole job.** Its title (e.g. `# Phase 7 — Template resolver` or `# Phase 10.5 — Review fixes`) tells you which phase you're in. Treat the prompt as authoritative over any intuition you have about what "should" come next.
- **Do only what this phase's prompt asks.** Do not create files, imports, dependencies, exports, or scaffolding that belong to a later phase — even if you can see they'll eventually be needed. Later phases will build on what you leave behind; pre-empting them causes rework and merge pain.
- **Main phases don't revisit earlier phases.** Earlier phases' work is already committed. In a main phase, if something from a previous phase seems wrong, flag it in your response for the user to decide — don't silently "fix" it. The only exception is hook-ups explicitly requested in the current prompt (e.g. "register this handler in the registry from Phase 8").
- **Supplemental phases are allowed to touch prior phases' work.** A prompt whose title is `Phase N.5`, `Phase N.6`, etc. is explicitly a supplemental/fix phase for a recently-completed main phase. Inside a supplemental phase you may modify, refactor, or fix files from earlier phases — but only within the scope the prompt lists. All the other rules still apply: stay within the prompt's `## Scope` / `## Items` / `## Constraints` sections, don't pre-empt later main phases, and end the phase with a green build. Supplemental phases commit separately from the main phase they follow.
- **Assume prior phases are complete and correct.** If the current prompt references a module, type, constant, or function that should already exist (e.g. `src/constants.ts`, `src/paths.ts`, the `Handler` interface), it does — import from it directly. Don't re-declare it, don't guess at its shape beyond what the prompt tells you, and don't inline a local copy.
- **Stay within scope.** Every phase prompt has a `## Constraints` section and ends with a commit-message template whose body bullets describe the phase's deliverables. Use them as a scope checklist. If something feels like it belongs to a neighbouring phase, it probably does — leave it.
- **Green build each phase.** Every phase must end with `npx tsc --noEmit` passing. The repo is only runnable end-to-end from Phase 20 onward; before then, "done" means "types compile and the phase's deliverables exist," not "aspyn runs."
- **No cross-phase commits.** One phase, one commit. The user will handle phase boundaries.

If the current prompt ever seems to contradict these conventions, the **prompt wins** — but call it out in your response so the user can decide whether it was intentional.

## Conventions

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
- **Every phase ends with `npx tsc --noEmit` passing** and `package.json` coherent. Runnability of aspyn as a whole returns at Phase 20.
- **Referencing v1**: the pre-v2 codebase is frozen on the `v1` git branch (not deleted — the v2 rewrite happens on `v2` / `main`). When a prompt tells you to port or consult a v1 implementation, inspect it via git without switching branches: `git show v1:<path>` to read a single file, `git ls-tree -r --name-only v1` to list files, or `git checkout v1 -- <path>` to materialise a file into the working tree (remember to `git rm --cached`/delete it afterwards so it doesn't leak into the v2 commit). Do NOT `git checkout v1`.
- **Commit messages**: when asked to produce a commit message, keep the title brief, body as condensed high-level bullet points, one blank line between title and body, no special formatting — ready to copy verbatim. Phase commits use the form `feat(v2): <brief scope> (phase <n>)`.

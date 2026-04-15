# aspyn

A local-first filesystem watcher and automation CLI. Watches are defined as JSONC configs under `~/.config/aspyn/<name>/config.jsonc` and execute a source → parse → check → action pipeline.

## Important

This project is built incrementally in phases. These conventions describe the final architecture — some files referenced below may not exist yet. **Only create files and imports that your current prompt asks for.** Do not create, import from, or reference files that have not been built yet.

## Conventions

- **No barrel files.** Never create `index.ts` re-export files. Every module imports directly from the file that defines what it needs (e.g. `import type { WatchConfig } from "./types/config.js"`).
- **File extensions in imports.** Always use `.js` extensions in import paths (TypeScript with NodeNext module resolution).
- **Types live in `src/types/`.** Pure type definitions — no runtime code. Three files: `config.ts`, `pipeline.ts`, `state.ts`.
- **One concern per file.** Handlers, utilities, and orchestration each get their own file.
- **No schema libraries.** Validation is simple and imperative.
- **Shell execution** uses `src/execution/shell.ts` — never call `child_process` directly elsewhere.
- **State** is persisted as JSON in `~/.local/share/aspyn/state/<name>/state.json`. Writes are atomic (write tmp + rename).
- **Logging** uses `src/logger.ts` (stderr). CLI user-facing output uses `console.log` (stdout). No raw `console.log/warn/error` in non-CLI files. (Note: the logger is introduced in a later phase — use `console.*` until `src/logger.ts` exists.)
- **Config paths** follow XDG conventions — see `src/config/paths.ts`.
- **Commit messages**: When asked to produce a commit message, always keep the title brief, and the body as condensed, very high level dot points, with one line between the title and body, and no special formatting for presentation (needs to be ready to copy)

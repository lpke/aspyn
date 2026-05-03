# 🌲 aspyn

[![GitHub](https://img.shields.io/badge/github-lpke%2Faspyn-blue?logo=github)](https://github.com/lpke/aspyn)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)

<!-- [![npm](https://img.shields.io/npm/v/@lpke/aspyn)](https://www.npmjs.com/package/@lpke/aspyn) -->

> A minimal CLI for stateful shell pipelines.

## Work in progress

The original, experimental version can be found at [`aspyn-legacy`](https://github.com/lpke/aspyn-legacy).

---

## Build

### Development testing

To run the TypeScript entrypoint without needing to build:

```sh
pnpm exec tsx src/aspyn.ts
```

`pnpm exec` runs the command with the local `node_modules/.bin` in the PATH, so it can find `tsx` without a global install.

### Node package

```sh
pnpm build
```

This creates `dist/npm/aspyn.js`, which is used by the npm package. Requires Node at runtime.

### Standalone executable

To build a Node SEA (Single Executable Application) for the current platform:

```sh
pnpm build:sea
```

This creates `dist/sea/<platform>/<architecture>/aspyn`, a standalone executable that doesn't require Node installed on the user's machine.

SEA builds are platform-specific, so build once per target OS/architecture.

#### Build flow

1. `esbuild` bundles `src/aspyn.ts` into `dist/sea/main.cjs`.
2. `scripts/build-sea.ts` reads `sea-config.json` and expands `{platform}` / `{architecture}` for the current machine.
3. Node SEA embeds `dist/sea/main.cjs` into the current Node executable and writes it to `dist/sea/<platform>/<architecture>/aspyn`.

**NOTE:** _Building_ the standalone executable requires **Node 25.5+** for `node --build-sea`.

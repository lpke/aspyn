# 🌲 aspyn

[![GitHub](https://img.shields.io/badge/github-lpke%2Faspyn-blue?logo=github)](https://github.com/lpke/aspyn)
[![npm](https://img.shields.io/npm/v/@lpke/aspyn)](https://www.npmjs.com/package/@lpke/aspyn)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)

> A local pipeline engine that gives your scripts a memory.

aspyn is an unopinionated CLI for running scriptable pipelines locally. Define a sequence of steps, point each one at a shell command or a built-in handler, and aspyn takes care of the rest — scheduling, state, change detection, crash recovery.

```jsonc
// ~/.config/aspyn/gpu-tracker/config.jsonc
{
  "interval": "6h",
  "pipeline": [
    { "type": "webpage", "input": { "url": "https://ple.com.au/Products/RTX-5080" } },
    { "type": "selector", "input": { "selectors": { "price": ".price-current::text" } } },
    { "type": "expr", "input": { "expression": "value.price < 1400" } },
    { "type": "notification-desktop", "input": { "title": "💸 GPU Price Drop", "message": "Now ${value.price}" } }
  ]
}
```

Every step is either a **shell string** or a **typed handler**. Steps feed their output and context to the next. aspyn persists state between runs, so each execution knows what changed since last time (or any time).

---

**Unopinionated.** Steps are generic — aspyn doesn't care what they do. Scrape a page, query an API, run a health check, clean up old files, train a model. If you can script it, aspyn can run it.

**Local-first.** Configs in `~/.config/aspyn/`, state in `~/.local/share/aspyn/`. XDG-native, everything on disk, no docker.

**Scriptable.** Shell strings pipe JSON between steps. Or use built-in handlers for HTTP, CSS selectors, JSONPath, regex, headless browsers, desktop notifications, webhooks, and more.

**Reliable.** PID-based locking, atomic state writes, append-only run journals, crash recovery, per-step retries with backoff, graceful shutdown.

**Schedulable.** Built-in daemon with hot-reload, or run from cron / systemd timers — same locking, same state.

---

## Getting Started

### Install

```bash
npm install -g @lpke/aspyn
# or
pnpm add -g @lpke/aspyn
```

Requires **Node.js ≥ 22**.

### Create a pipeline

Scaffold a new pipeline config with:

```bash
aspyn init <name>
```

This creates `~/.config/aspyn/<name>/config.jsonc` pre-populated with a minimal four-step template (`input → parse → check → action`). Pass `--no-interval` to omit the schedule.

### Define your steps

Edit the generated config — every step is either a **shell string** or a **typed handler object**:

```jsonc
// ~/.config/aspyn/my-pipeline/config.jsonc
{
  // optional — duration shorthand (eg 30s, 5m, 6h, 1d) or a cron expression
  // only used when running through `aspyn daemon`
  "interval": "1h",

  "pipeline": [
    // typed handler — built-in, no shell required
    {
      "name": "fetch",
      "type": "http",
      "sideEffect": false, // this step doesnt count as a side-effect (should run on `--dry`)
      "input": { "url": "https://api.example.com/data" },
      // error fallback. runs then aborts the pipeline
      "onError": {
        "type": "notification-desktop",
        "input": {
          "title": "aspyn",
          "message": "fetch failed for my-pipeline",
        },
      },
    },

    // shell string — stdout becomes the next step's input
    "jq '.nested.price'",

    // extract fields from the response
    {
      "name": "parse",
      "type": "jsonpath",
      "input": { "queries": { "price": "$.data.price" } },
    },

    // `expr` acts as a pipeline gate — if falsy, the pipeline halts here
    {
      "name": "check",
      "type": "expr",
      "input": { "expression": "price < 100" },
    },

    // `when` skips just this step (without halting) if the expression is falsy
    // ${...} templates resolve from named step outputs
    {
      "type": "notification-desktop",
      "input": { "title": "Price drop!", "message": "Now ${price}" },
      "when": "price != null",
    },

    // log handler — appends pipeline data to `action.log` (vs `run.log` for engine output)
    {
      "name": "log",
      "type": "log",
      "input": { "format": "json", "level": "info" },
    },
  ],
}
```

**Built-in handler types:** `http`, `webpage`, `css-selector`, `jsonpath`, `regex`, `expr`, `shell`, `file`, `notification-desktop`, `log`.

### Run it

```bash
aspyn run <name>            # run once
aspyn run <name> --verbose  # with step-level output
aspyn run <name> --dry      # dry run — skip side-effect steps
aspyn run --all             # run every pipeline
```

### Schedule with the daemon

The built-in daemon reads each pipeline's `interval` and runs them on schedule with hot-reload:

```bash
aspyn daemon
```

Or drop it into a systemd user unit / launchd plist and let the OS manage it. aspyn's PID lock ensures only one instance runs at a time, whether started by the daemon or cron.

### Inspect state

```bash
aspyn list                            # all pipelines, last run, status
aspyn state show <name>               # full persisted state
aspyn state show <name> --step parse  # single step's last output
aspyn state history <name>            # run history table
aspyn state history <name> --since 24h --format json
aspyn state diff <name>               # diff last two runs
aspyn state clear <name>              # reset state
```

### Validate configs

```bash
aspyn validate              # check all pipeline configs
aspyn validate --format json
```

---

Still under active development. More docs coming soon.

![aspen_trees](https://i.imgur.com/KzT8YVH.jpeg)

## License

This project is licensed under the GNU Affero General Public License v3.0 only. Full text: [LICENSE](./LICENSE).

Copyright © 2026 Luke Perich ([lpdev.io](https://www.lpdev.io))

# 🌲 aspyn

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)

> A local pipeline engine that gives your scripts a memory.

aspyn is an unopinionated CLI for running scriptable pipelines locally. Define a sequence of steps in JSONC, point each one at a shell command or a built-in handler, and aspyn takes care of the rest — scheduling, state, change detection, crash recovery.

```jsonc
// ~/.config/aspyn/gpu-tracker/config.jsonc
{
  "interval": "6h",
  "pipeline": [
    { "type": "webpage", "input": { "url": "https://ple.com.au/Products/RTX-5080" } },
    { "type": "selector", "input": { "selectors": { "price": ".price-current::text" } } },
    { "type": "expr", "input": { "expression": "value.price < 1400" } },
    { "type": "notification-desktop", "input": { "title": "💸 GPU Price Drop", "message": "Now ${value.price}" } }
    { "type": "log" }
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

Still under active development. More docs coming soon.

![aspen_trees](https://i.imgur.com/KzT8YVH.jpeg)

## License

This project is licensed under the GNU Affero General Public License v3.0 only. Full text: [LICENSE](./LICENSE).

Copyright © 2026 Luke Perich ([lpdev.io](https://www.lpdev.io))

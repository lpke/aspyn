# 🌲 aspyn

> A local orchestration engine that gives your scripts a memory — effectively stateful bash.

aspyn is a config-driven CLI for building watch pipelines that source, parse, check, and act — on any file, in any language. Designed for anyone who wants to monitor or automate anything without the overhead of a full CI/CD suite.

![aspen_trees](https://i.imgur.com/GN0kraF.jpeg)

aspyn watches things for you. One JSONC config per watch: fetch data, parse it, check a condition, run an action. Shell strings or built-in typed handlers at every step — mix freely.

```jsonc
// ~/.config/aspyn/api-watcher/config.jsonc
{
  "interval": "30m",
  "source": { "type": "http", "input": { "url": "https://api.example.com/status" } },
  "check": "changed",
  "action": "./notify.sh"
}
```

## Getting started

aspyn is still under active development, but is in a working state if you want to try it out.

```bash
# install and set up alias
git clone git@github.com:lpke/aspyn.git
pnpm install
alias aspyn="pnpm exec tsx src/cli.ts"

# create a watch
aspyn init price-alert
# then configure at ~/.config/aspyn/price-alert/config.jsonc

# run the watch(es)
aspyn run price-alert        # run once
aspyn run --all              # run everything once
aspyn daemon                 # start the scheduler
```

## Pipeline

```
source (optional) → parse (optional) → check (optional) → action (required)
```

Every step accepts a **shell string** (stdin/stdout JSON) or a **typed handler object**. Check and action steps receive full pipeline context (`value`, `prev`, `changed`, `firstRun`, `meta`).

### Built-in Handlers

| Sources | Parsers | Checks | Actions |
|---------|---------|--------|---------|
| `http` — fetch a URL | `selector` — CSS via Cheerio | `expr` — JS expression | `shell` — run a command |
| `file` — read a file | `json` — JSONPath queries | | `webhook` — HTTP + templates |
| `shell` — run a command | `regex` — named captures | | `desktop` — native notification |
| `webpage` — headless browser | | | `log` — append to action log |

Actions support arrays (sequential). Template strings expand `value.*`, `prev.*`, `meta.*`, and env vars.

## CLI

```
aspyn run <name>              Run a single watch
aspyn run --all               Run all watches
aspyn daemon                  Start the scheduler
aspyn list                    List watches with status
aspyn log <name>              Show run/action/state logs
aspyn state <name>            Print persisted state
aspyn validate                Validate all configs
aspyn init <name>             Scaffold a new watch
```

Flags: `--verbose`, `--dry` (skip actions).

## Directory Layout

```
~/.config/aspyn/
├── config.jsonc              # Global defaults
└── <watch>/
    ├── config.jsonc          # Watch definition
    └── *.sh / *.js           # Co-located scripts (CWD = watch dir)

~/.local/share/aspyn/
├── state/<watch>/
│   ├── state.json            # Last value, status, timestamps
│   ├── state-history.jsonl   # Append-only (one JSON line per run)
│   └── lock                  # PID-based lock file
└── logs/<watch>/
    ├── run.log               # Operational (every run)
    └── action.log            # Data ("log" action only)
```

Paths follow XDG conventions (`$XDG_CONFIG_HOME`, `$XDG_DATA_HOME`).

## Scheduling & Reliability

**Intervals** — shorthands (`30s`, `5m`, `1h`, `1d`) or cron expressions. Minimum 10s.

**Daemon** — `aspyn daemon` schedules all watches via node-cron. Hot-reloads configs on every tick. Detects new/removed watches within 60s.

**External schedulers** — `aspyn run` works with cron, systemd timers, etc. Same locking and state.

**Reliability** — PID-based file locking, crash recovery, missed-run policies (`run_once`/`skip`/`run_all`), per-step retries with backoff, `onError` hook, graceful SIGINT/SIGTERM shutdown, log rotation.

## Examples

<details><summary>GPU price tracker — webpage + selector + threshold</summary>

```json
{
  "interval": "15m",
  "source": { "type": "webpage", "input": { "url": "https://www.ple.com.au/Products/RTX-5080", "waitFor": ".price-current" } },
  "parse": { "type": "selector", "input": { "selectors": { "price": ".price-current::text", "stock": ".stock-level::text" } } },
  "check": "parseFloat(value.price.replace(/[^\\d.]/g, '')) < 1400 && value.stock.includes('In Stock')",
  "action": [
    { "type": "desktop", "input": { "title": "💸 GPU Price Drop", "message": "Now value.price — in stock!", "sound": true } },
    { "type": "log" }
  ]
}
```
</details>

<details><summary>GitHub release watcher — API + JSONPath + change detection</summary>

```json
{
  "interval": "6h",
  "source": { "type": "http", "input": { "url": "https://api.github.com/repos/neovim/neovim/releases/tags/nightly", "headers": { "Accept": "application/vnd.github.v3+json" } } },
  "parse": { "type": "json", "input": { "queries": { "tag": "$.tag_name", "published": "$.published_at", "url": "$.html_url" } } },
  "check": "changed",
  "action": { "type": "desktop", "input": { "title": "🌙 Neovim Nightly", "message": "New build: value.published" } }
}
```
</details>

<details><summary>DNS change detector — pure shell, zero typed handlers</summary>

```json
{
  "interval": "15m",
  "source": "dig +short A myapp.com | jq -R -s '{ips: split(\"\\n\") | map(select(. != \"\"))}'",
  "check": "changed",
  "action": "echo 'DNS changed for myapp.com' | mail -s 'aspyn: DNS alert' ops@example.com"
}
```
</details>

<details><summary>Scheduled task — aspyn as a friendlier crontab</summary>

```json
{
  "interval": "1d",
  "action": "nix-collect-garbage --delete-older-than 14d 2>&1 | tail -1"
}
```
</details>

## Requirements

- **Node.js** ≥ 18, **Unix** only (no Windows)
- **Playwright** (optional) — for `webpage` source
- **`notify-send`** (Linux) — for `desktop` action (macOS works natively)

## License

This project is licensed under the GNU Affero General Public License v3.0 only. Full text: [LICENSE](./LICENSE).

Copyright © 2026 Luke Perich ([lpdev.io](https://www.lpdev.io))

# 🌲 aspyn

> Scriptable, config-driven watch pipelines — any source, any language, any action.

![aspen_trees](https://i.imgur.com/GN0kraF.jpeg)

You want to know when something changes — a price drops, a repo releases, a disk fills up, errors start spiking. aspyn watches for you. One config file per watch: any source, any language, any action. It doesn't care how you do it — it just runs your pipeline on a schedule and stays out of the way.

`~/.config/aspyn/api-watcher/config.jsonc`

```json
{
  "interval": "30m",
  "source": {
    "type": "http",
    "input": { "url": "https://api.example.com/status" }
  },
  "check": "changed",
  "action": "./notify.sh"
}
```

## Philosophy

- **Config is king** — `~/.config/aspyn/*/config.jsonc` is the entire state of your watchers. Back it up, version it, share it.
- **Everything is scriptable** — every step can be a shell string. Any language, any tool.
- **Typed handlers are a convenience layer** — built-ins like `{ type: "http" }` save boilerplate for common tasks, but anything they do, a script can do too.
- **Functional pipeline** — data flows `source → parse → check → action`. Each step receives the previous step's output as JSON on stdin and writes JSON to stdout.
- **Unopinionated** — aspyn doesn't care what you watch, how you parse, or what you do about it.

## License

This project is licensed under the GNU Affero General Public License v3.0 only. Full text: [LICENSE](./LICENSE).

Copyright © 2026 Luke Perich ([lpdev.io](https://www.lpdev.io))

# aspyn

A local-first CLI for scriptable, config-driven pipelines.

> **v2 in progress.** This branch is a WIP rewrite and is not runnable end-to-end until the Phase 20 cutover. For v1 documentation, see the `v1` branch.

## Major v2 changes

- Generic named-step pipelines replace the fixed source/parse/check/action flow
- Unified `http` handler covering both GET and POST requests
- jexl-powered expressions and template resolution
- Crash recovery via live journal
- Richer state history and CLI commands: state list/show/history/diff/clear, --from/--until/--dry
- Per-step retry and timeout support
- proceedOnError/continueOnError with \_\_error/\_\_failed injection
- 1s minInterval floor
- Manual-run-only pipelines (interval is optional)

## License

This project is licensed under the GNU Affero General Public License v3.0 only. Full text: [LICENSE](./LICENSE).

Copyright © 2026 Luke Perich ([lpdev.io](https://www.lpdev.io))

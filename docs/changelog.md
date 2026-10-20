# Development changelog

## 2026-10-20 - Azure imagery catalogs

Implemented issue #158 on a develop-based feature branch and activated it in the
local app without resetting the existing seeded database. Imports reuse bounded
registration workers; metadata failures remain visible, and catalog presets are
copied through the existing imagery editor.

Core: `68802fe8`, `a78a03c3`, `03b8dd23`. Companion tiler: `04e6b7e`.
Backend tests: 1528; frontend units: 1387; tiler tests: 123; catalog browser cases:
3. Full browser suite remains red; live Azure import/rendering is not verified.
No publication to develop/main.

See [implementation report](review/implement-cloud-catalog/report.md) for commands,
local URLs, review findings and remaining acceptance work.

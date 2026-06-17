# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **WebView introspection tools** (tool count 28 → **33**): `webview_inspect`
  (resolve a CSS selector to DOM elements with absolute `tapX`/`tapY` tap
  coordinates), `webview_eval` (run JS in the page context), `webview_navigate`
  (goto/back/forward/reload). Powered by the bundled `mobilecli` over CDP;
  require `WKWebView.isInspectable = true` (debug/staging builds).
- **Raw-coordinate tap tools**: `tap_with_fallback` (tap + before/after
  screenshot verification with offset retries, for WebGL/Canvas overlays) and
  `notification_bar_clear`.
- **Native gesture backend** (`mobilecli` bundled, `idb` when available):
  `tap_on`, `input_text`, `swipe`, `press_key`, `orientation_set` and
  `inspect_screen` route through a native backend with Maestro fallback —
  eliminating the per-gesture JVM spin-up (`tap_on` ~14.7 s → ~0.6 s).
- `inspect_screen` compact mode (default) — flat list of meaningful nodes.
- `orientation_get` native query with screenshot-heuristic fallback.
- `device_boot` is now idempotent (already-booted → `alreadyBooted: true`).
- `device_list` TTL cache + boot-time prefetch.
- `PODIUM_DISABLE_NATIVE` env switch to force the Maestro path.
- `scripts/benchmark.ts` + `npm run benchmark` — drives all 33 tools.

### Fixed

- Removed hardcoded per-user paths (`~/.maestro`, `JAVA_HOME`) — now resolved
  dynamically (`PATH`/`$HOME`, `/usr/libexec/java_home`, Homebrew).

## [0.1.0] - 2026-06-06

### Added

- Initial release: a single MCP stdio server (`podium`) merging three mobile
  tool MCPs into **28 tools** with a shared `execFile` runner and consistent
  structured error handling.
- **Device & apps**: `device_list`, `device_boot`,
  `app_install`, `app_launch`, `app_terminate`, `app_uninstall`, `app_list`,
  `app_state`, `open_url`, `set_location`, `screen_size`, `orientation_get`.
- **UI interaction & flows** (Maestro engine): `inspect_screen`, `tap_on`,
  `input_text`, `swipe`, `press_key`, `orientation_set`, `run_flow`,
  `cheat_sheet` (bundled offline).
- **Capture**: `screenshot`, `record_start`, `record_stop`.
- **React Native debugging** (Metro CDP): `metro_apps`,
  `metro_logs` (native CDP), `crash_list`, `crash_get` (host + simulator
  DiagnosticReports).
- `podium_health` toolchain detection (xcrun / maestro / adb).
- idb-flakiness retry with backoff for Maestro flows.
- Docs: `README.md`, `docs/tool-catalog.md`, `docs/e2e-demo.md`.
- 61 unit tests (vitest); TypeScript strict; no type suppression.

[0.1.0]: https://github.com/nhonhgeargame/podium-mcp/releases/tag/v0.1.0

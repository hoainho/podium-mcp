# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-06-23

### Added

- **Game-engine automation, no vision** (tool count 43 → **47**) —
  `engine_inspect` / `engine_tap` / `engine_swipe` / `engine_call` drive
  Unity/WebGL/GL UIs as addressable objects (by name/path/component) with
  engine-reported screen coordinates, via an AltTester bridge (native, over a
  forwarded port) or a WebGL-in-WebView CDP bridge (`window.__podiumEngine`).
  Requires an AltTester-instrumented build; otherwise fails closed with an
  actionable error — never a vision fallback.
- **Android (emulator + real)** — an `adb` platform driver
  (list/install/launch/screenshot/`wm size`) and an `adb` gesture/inspect
  backend (`input tap/swipe/text/keyevent`, `uiautomator dump` → accessibility
  elements). `tap_on`/`swipe`/`input_text`/`inspect_screen` now work on Android.
- **Real iOS device** — a `devicectl`-based lifecycle driver
  (list/install/launch) and an opt-in WebDriverAgent gesture/inspect backend
  (`PODIUM_WDA_URL`; `/source` accessibility tree + tap/swipe/keys). Missing
  real-device prerequisites (signing, iOS-17 RSD tunnel) fail closed with
  guidance.

### Changed

- **Multi-platform device abstraction** — a `DeviceTarget { platform }` model
  and a `PlatformDriver` registry replace the iOS-Simulator-only assumption; the
  gesture/inspect backend is selected per target (`getBackendFor`). The existing
  iOS-sim path is unchanged.

> Real-device (Android/iOS) and engine paths land code-complete with
> unit/integration coverage. Live end-to-end on a real emulator/device and an
> AltTester-instrumented Unity sample are tracked for a hardware-equipped CI
> (roadmap stories A3 / B3 / C4).

## [0.2.0] - 2026-06-17

### Added

- **`webview_network`** (tool count 42 → **43**): captures HTTP traffic made
  *inside* a WebView (fetch + XMLHttpRequest) and exports redacted JSON or a
  HAR 1.2 log. This is the network-debugging path for WebView-based apps — RN
  shells that host their UI in a WKWebView, where the app's API calls run in the
  web layer and `metro_network` (CDP Network domain) captures nothing. Injects an
  in-page fetch/XHR recorder via `webview_eval`, captures for `durationMs` while
  you drive the app, then returns request/response metadata (url, method, status,
  headers, timing). It also merges the browser's Performance Resource Timing buffer
  (`includeResources`, default on) — every request the document made *since
  navigation*, including ones that fired before capture started (URL/timing/size,
  no headers/body) — so the export is a near-complete request list rather than only
  what fired during the window. Sensitive headers and request bodies are redacted by
  default. Gated by `PODIUM_DISABLE_WEBVIEW_EVAL=1` like `webview_eval`.
- **React Native introspection tools** (tool count 34 → **36**): `metro_network`
  (capture requests via CDP `Network.enable` — url/method/status/mimeType/ts) and
  `metro_state` (read in-app state via CDP `Runtime.evaluate`, default a
  globally-exposed Redux store).
- **WebView introspection tools** (tool count 28 → **34**): `webview_inspect`
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
- `scripts/benchmark.ts` + `npm run benchmark` — drives all 34 tools.

### Fixed

- Removed hardcoded per-user paths (`~/.maestro`, `JAVA_HOME`) — now resolved
  dynamically (`PATH`/`$HOME`, `/usr/libexec/java_home`, Homebrew).
- **Reliability (v0.2.0):**
  - `launch`/`openUrl`/`terminate`/`setLocation` now use explicit timeouts
    (launch 30 s) instead of the 5 s default — cold RN launches no longer report
    a misleading "failed". `RunResult` carries a `timedOut` flag so callers can
    tell a timeout from a real failure.
  - `record_start` default path is timestamped (no silent overwrite across
    start→stop→start) and a duration watchdog (`PODIUM_MAX_RECORDING_MS`,
    default 10 min) finalizes a recording that is never stopped.
  - Native backend selection now re-probes after a short TTL when no backend is
    found, instead of caching "none" for the whole process — idb/mobilecli that
    starts after launch is picked up instead of permanently downgrading to Maestro.
  - `app_state` uses exact bundle-id matching (no `com.foo`→`com.foobar` false
    positives) for both `installed` and `running`.
  - `tap_with_fallback` no longer blindly walks `y` upward on unverified taps
    (`offsetStep` now defaults to 0, opt-in); its screenshot byte-size oracle is
    documented as a best-effort heuristic.
  - `metro_apps` reports differentiated errors (timeout vs not-running vs other)
    instead of always "metro not running".

### Changed

- **Gesture executors deduplicated:** the native→Maestro fallback ladder for
  swipe / key / type / tap-by-text now lives once in `lib/gesture.ts`
  (`nativeKey`, `nativeInputText`, `nativeSwipe`, `nativeTapText`); both the
  discrete `screen.ts` tools and the `run_steps` batch executor call it, so they
  can no longer drift. A parity test asserts identical behavior across both entry
  points.
- Tool descriptions clarified: `run_steps`/`run_flow` "when to use" routing
  hints; `tap_on`/`run_steps` document anchored text-match semantics; `tap_on`
  no longer claims percent coordinate support.
- `webview_eval` can be disabled with `PODIUM_DISABLE_WEBVIEW_EVAL=1`; SECURITY.md
  now documents the `webview_eval`/`run_flow` trust boundary and PII-in-transcript
  caveat.
- `.npmrc` sets `engine-strict=true` so installs fail clearly on Node < 22.

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
- 66 unit tests (vitest); TypeScript strict; no type suppression.

[0.3.0]: https://github.com/hoainho/podium-mcp/releases/tag/v0.3.0
[0.2.0]: https://github.com/hoainho/podium-mcp/releases/tag/v0.2.0
[0.1.0]: https://github.com/hoainho/podium-mcp/releases/tag/v0.1.0

# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-06-25

### Added

- **Canvas Brain — no-vision canvas/WebGL automation** (tool count 47 → **51**) —
  `canvas_inspect` / `canvas_resolve` / `canvas_tap` address UIs drawn on a
  `<canvas>` like DOM/native elements, with ZERO screenshots. An injected in-page
  bridge auto-detects the scene graph of **Pixi / Konva / Fabric / Phaser /
  Three.js / Babylon.js** and reports each node's tap-ready CSS-px coordinates
  (DPR-correct). `canvas_resolve` is the "close brain": it maps a fuzzy intent
  ("close", "✕", "settings") to a ranked, **evidenced** target and **fails
  closed** when two targets tie; `canvas_tap` resolves + taps the confident match
  at absolute screen coordinates. Requires an inspectable WKWebView hosting a
  supported framework — otherwise fails closed with an actionable error, never a
  vision fallback.
- **`/podium-mcp:canvas` skill** — a one-command canvas agent
  (inspect → resolve → act) over the canvas tools.
- **`podium_token_report` + `npm run token-bench`** — quantifies Podium's token
  savings: for an N-step flow it computes no-vision (structured element-list) vs
  screenshot/vision-loop input tokens, the savings ratio, and the fixed
  per-request tool-definition overhead (heuristic estimators; swap in Anthropic
  `count_tokens` for exact figures). See `docs/token-economics.md`.
- **Opportunistic accessibility + opt-in vision fallback** — `canvas-a11y` reads
  a Flutter `flt-semantics` / ARIA fallback tree when present (free, no vision);
  `canvas-vision` is an **opt-in, token-budgeted** last resort
  (`PODIUM_ALLOW_VISION=1`), off by default and fail-closed.

### Changed

- **Tool count 47 → 51**; `podium_health` scope now includes no-vision
  canvas/WebGL automation.

> Validated live: a Playwright-WebKit suite (≈ WKWebView; `npm run test:canvas`,
> 19 tests at DPR 1 + 3) drives the real bridge against real
> Pixi/Konva/Fabric/Phaser/Three/Babylon scene graphs. It caught and fixed three
> bridge bugs before release — a Konva `"*"`-selector that returned nothing, a
> `1/DPR` over-scale on the 2D adapters, and missing hit-test bounds on 3D meshes
> — that the mocked unit tests could not surface. Unit coverage stays at 359
> tests across 31 files; real-device WKWebView e2e (a sample app) is a follow-up.

## [0.3.0] - 2026-06-24

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
  (list/install/launch; the iOS-17+ RSD tunnel is auto-mounted by `devicectl`,
  verified live on an iPhone 12 Pro Max) and an opt-in WebDriverAgent
  gesture/inspect backend (`PODIUM_WDA_URL`; `/source` accessibility tree +
  tap/swipe/keys). Missing prerequisites (signing, a paired/unlocked device,
  WDA) fail closed with guidance.

### Changed

- **Multi-platform device abstraction** — a `DeviceTarget { platform }` model
  and a `PlatformDriver` registry replace the iOS-Simulator-only assumption; the
  gesture/inspect backend is selected per target (`getBackendFor`). The existing
  iOS-sim path is unchanged. `resolvePlatform()` derives a device's platform from
  the live device list (a real CoreDevice iPhone UUID is indistinguishable from a
  sim UDID by format — verified on an iPhone 12 Pro Max).
- **Platform-aware capture** — `screenshot` and `record_start`/`record_stop`
  route by platform: iOS-sim (`simctl`), Android (`adb` screencap/pull and
  `screenrecord`+pull), real iOS (screenshot tries `idb`, then falls back to
  `idevicescreenshot`; video via `idb record-video`). Real-iOS capture fails
  closed with install guidance when no capture backend is present. Note: on
  Apple-Silicon + iOS 17+ with an older Xcode, no CLI capture backend may be
  installable (the device speaks only Apple's CoreDevice tunnel) — see
  `docs/real-device-ios-runbook.md`.

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

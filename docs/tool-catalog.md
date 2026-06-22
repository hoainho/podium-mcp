# Tool catalog

The authoritative tool-by-tool reference for podium-mcp: every tool, its
parameters, the backing engine it drives, and its behavior. Tools are grouped by
capability. All tools return structured JSON content and never throw — failures
come back as MCP tool errors.

> Primary target: macOS + iOS Simulator. Android paths degrade gracefully when
> `adb` is absent.

## Health

| Tool | Params | Backing engine | Returns |
|---|---|---|---|
| `podium_health` | — | `which` probes | `{ name, version, toolchain: { xcrun, maestro, adb } }` — never fails |

## Device & simulator

| Tool | Params | Backing engine | Returns / behavior |
|---|---|---|---|
| `device_list` | — | `xcrun simctl list -j` + `adb devices` | `{ ios: [...], android }`; adb absent → `android: { available: false }` |
| `device_boot` | udid | `simctl boot` | `{ ok }`; waits up to 30s |
| `screen_size` | udid | `simctl io screenshot` + `sips` | `{ widthPx, heightPx }` (real pixels) |
| `orientation_get` | udid | screenshot aspect ratio | `{ orientation, widthPx, heightPx, basis }` (heuristic) |
| `set_location` | udid, latitude, longitude | `simctl location set` | `{ ok }` — unblocks location-gated flows |
| `open_url` | udid, url | `simctl openurl` | `{ ok }` — deep links + https |

## Apps

| Tool | Params | Backing engine | Returns / behavior |
|---|---|---|---|
| `app_list` | udid | `simctl listapps` + `plutil` | `{ count, apps: [{ bundleId, name, type }] }` |
| `app_install` | udid, path (.app/.zip) | `simctl install` | `{ ok }` |
| `app_launch` | udid, bundleId | `simctl launch` | `{ ok }` |
| `app_terminate` | udid, bundleId | `simctl terminate` | `{ ok }` |
| `app_uninstall` | udid, bundleId | `simctl uninstall` | `{ ok }` |
| `app_state` | udid, bundleId | `simctl listapps` + `launchctl list` | `{ installed, running }` |

## Capture

| Tool | Params | Backing engine | Returns / behavior |
|---|---|---|---|
| `screenshot` | udid, saveTo? (.png/.jpg) | `simctl io screenshot` | `{ path, byteSize }` (no base64 bloat) |
| `record_start` | udid, saveTo? (.mp4) | detached `simctl io recordVideo` | `{ ok, path, pid }`; one recording per udid |
| `record_stop` | udid | SIGINT recorder + flush | `{ ok, path, sizeBytes }` |

## UI inspection & interaction

Imperative gestures generate a minimal ephemeral flow with
`launchApp: { stopApp: false }`, so the app is foregrounded **without
restarting** and sequential interactions preserve state.

| Tool | Params | Backing engine | Returns / behavior |
|---|---|---|---|
| `inspect_screen` | udid | native (idb/mobilecli) first, else `maestro hierarchy` | Compact hierarchy JSON; native flat-tree path is used when a backend is present (fast), Maestro is the fallback |
| `tap_on` | udid, bundleId, text \| id \| x+y, double?, long?, index? | ephemeral `tapOn`/`doubleTapOn`/`longPressOn` | Validated before exec; idb retry |
| `input_text` | udid, bundleId, text, submit? | ephemeral `inputText` (+`pressKey: Enter`) | idb retry |
| `swipe` | udid, bundleId, direction, start/end? | ephemeral `swipe` | idb retry |
| `press_key` | udid, bundleId, key | ephemeral `pressKey` | back/power/tab are Android-only |
| `orientation_set` | udid, bundleId, value | ephemeral `setOrientation` | PORTRAIT / LANDSCAPE_LEFT / LANDSCAPE_RIGHT / UPSIDE_DOWN |

## Flows (end-to-end)

| Tool | Params | Backing engine | Returns / behavior |
|---|---|---|---|
| `run_flow` | udid + exactly one of {yaml, files, dir(+include/exclude tags)}, env?, timeoutMs? | `maestro test` | Exactly-one-of validated before exec; per-step pass/fail + reason |
| `cheat_sheet` | — | bundled `assets/maestro-cheat-sheet.yaml` | Offline flow-syntax reference |

## React Native debugging

| Tool | Params | Backing engine | Returns / behavior |
|---|---|---|---|
| `metro_apps` | port? (8081) | GET `http://localhost:<port>/json` | CDP targets; Metro down → structured error |
| `metro_logs` | webSocketDebuggerUrl? / port?, durationMs?, maxLogs? | native WebSocket + CDP `Runtime.enable` | Auto-discovers first app when URL omitted |
| `metro_network` | webSocketDebuggerUrl? / port?, durationMs?, maxEntries? | CDP `Network.enable` (requestWillBeSent/responseReceived) | Merged request entries (url/method/status/mimeType/ts); auto-discovers app |
| `metro_state` | expression? / webSocketDebuggerUrl? / port?, timeoutMs? | CDP `Runtime.evaluate` (returnByValue) | Reads in-app state (default: globally-exposed Redux store) |
| `crash_list` | processName?, sinceHours?, udid? | host + sim-container `DiagnosticReports` | Newest-first; each entry tagged `source: host \| simulator` |
| `crash_get` | id, udid? | same | Path-traversal-safe (basename only); truncates honestly |

## Deferred to a future version

- **Cloud flow execution** + cloud device listing/status — local simulator is the current focus.
- **Live interactive viewer** — out of scope for a headless stdio server today.

## Known limits (documented, not worked around)

- **Maestro idb flakiness** (`Failed to connect to 127.0.0.1`) → automatic retry with 2s/5s backoff, then a structured error advising a simulator reboot.
- **WebGL canvas content is un-automatable** (no DOM/hierarchy) — `inspect_screen` returns the native layer only.
- **WebView tools require an inspectable WKWebView** — `webview_inspect`/`webview_eval`/`webview_navigate`/`webview_network` need `webView.isInspectable = true` (iOS 16.4+), which is the default in debug/staging builds but **off in production/App Store builds**. When no inspectable WebView is found they return an actionable error; the fallback is to locate the element visually via screenshot and tap with `tap_on`/`tap_with_fallback` x/y coordinates.
- **WebView-based apps' network lives in the web layer** — for an RN shell that hosts its UI in a WKWebView, the app's HTTP traffic runs in the page (web fetch/XHR), so `metro_network` (CDP Network domain on the RN/Hermes target) captures nothing. Use **`webview_network`**: it injects a fetch/XHR recorder (rich: method/status/headers/body for calls made *after* capture starts) AND reads the browser's Performance Resource Timing buffer (`includeResources`, default on) — every request the document made *since navigation*, including ones from before capture (URL/timing/size, no headers/body). The merge gives a near-complete request list. Remaining limits: the resource buffer defaults to 250 entries (podium bumps it to 3000 on injection, but entries dropped *before* injection on a long-loaded page are unrecoverable — reload then capture for a full boot trace); WebSocket frames and `navigator.sendBeacon` requests aren't always surfaced; native-module (non-WebView) requests are invisible by design.
- **No Android SDK assumption** — all adb paths degrade to a structured "adb not found" result.
- **WebView content-process memory is unreadable** from the app sandbox (platform limit) — use indirect signals (memory warnings, process terminations).
- **`orientation_get` is a screenshot-aspect heuristic** — iOS simulators expose no direct orientation query.
- **`record_start`/`record_stop` hold state in-process** — clients must serialize `start` → `stop` on one connection; one active recording per udid.

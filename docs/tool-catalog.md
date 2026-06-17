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
| `inspect_screen` | udid | `maestro hierarchy` | Compact hierarchy JSON; detects unsupported engine versions |
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
| `crash_list` | processName?, sinceHours?, udid? | host + sim-container `DiagnosticReports` | Newest-first; each entry tagged `source: host \| simulator` |
| `crash_get` | id, udid? | same | Path-traversal-safe (basename only); truncates honestly |

## Deferred to a future version

- **Cloud flow execution** + cloud device listing/status — local simulator is the current focus.
- **Live interactive viewer** — out of scope for a headless stdio server today.

## Known limits (documented, not worked around)

- **Maestro idb flakiness** (`Failed to connect to 127.0.0.1`) → automatic retry with 2s/5s backoff, then a structured error advising a simulator reboot.
- **WebGL canvas content is un-automatable** (no DOM/hierarchy) — `inspect_screen` returns the native layer only.
- **No Android SDK assumption** — all adb paths degrade to a structured "adb not found" result.
- **WebView content-process memory is unreadable** from the app sandbox (platform limit) — use indirect signals (memory warnings, process terminations).
- **`orientation_get` is a screenshot-aspect heuristic** — iOS simulators expose no direct orientation query.
- **`record_start`/`record_stop` hold state in-process** — clients must serialize `start` → `stop` on one connection; one active recording per udid.

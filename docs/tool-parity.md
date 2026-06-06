# Tool Parity Spec — podium-mcp vs the 3 source MCPs

> Captured 2026-06-05 from the live tool schemas of the three installed MCPs.
> This is the authoritative mapping for which capabilities podium must absorb.

## Source 1: mobile-mcp (`@mobilenext/mobile-mcp`)

| Source tool | Params | podium tool | Backing engine |
|---|---|---|---|
| `mobile_list_available_devices` | — | `device_list` | `xcrun simctl list -j` + `adb devices` (graceful absence) |
| `mobile_install_app` | device, path (.app/.zip iOS sim, .apk, .ipa) | `app_install` | `simctl install` / `adb install` |
| `mobile_launch_app` | device, packageName, locale? | `app_launch` | `simctl launch` / `adb shell am start` |
| `mobile_terminate_app` | device, packageName | `app_terminate` | `simctl terminate` |
| `mobile_uninstall_app` | device, bundle_id | `app_uninstall` | `simctl uninstall` |
| `mobile_list_apps` | device | `app_list` | `simctl listapps` |
| `mobile_take_screenshot` | device | `screenshot` | `simctl io screenshot` |
| `mobile_save_screenshot` | device, saveTo (.png/.jpg) | `screenshot` (saveTo param) | same |
| `mobile_list_elements_on_screen` | device | `inspect_screen` (merged w/ Maestro hierarchy) | maestro hierarchy |
| `mobile_click_on_screen_at_coordinates` | device, x, y | `tap_on` (point mode) | ephemeral Maestro flow `tapOn: {point}` |
| `mobile_double_tap_on_screen` | device, x, y | `tap_on` (double:true) | `doubleTapOn` |
| `mobile_long_press_on_screen_at_coordinates` | device, x, y, duration≤10000 | `tap_on` (long:true) | `longPressOn` |
| `mobile_swipe_on_screen` | device, direction, x?, y?, distance? | `swipe` | ephemeral flow `swipe` |
| `mobile_type_keys` | device, text, submit | `input_text` | `inputText` (+`pressKey: Enter` if submit) |
| `mobile_press_button` | device, button (HOME, BACK, VOLUME_*, ENTER…) | `press_key` | `pressKey` |
| `mobile_open_url` | device, url | `open_url` | `simctl openurl` |
| `mobile_get_orientation` / `mobile_set_orientation` | device, orientation | `orientation` (get/set) | `setOrientation` flow / simctl |
| `mobile_get_screen_size` | device | `screen_size` | simctl/device info |
| `mobile_list_crashes` / `mobile_get_crash` | device, id | `crash_list` / `crash_get` | sim DiagnosticReports |
| `mobile_start_screen_recording` / `mobile_stop_screen_recording` | device, output?, timeLimit? | `record_start` / `record_stop` | `simctl io recordVideo` |

## Source 2: Maestro MCP (`maestro mcp`)

| Source tool | Params | podium tool | Notes |
|---|---|---|---|
| `run` | device_id + exactly one of {yaml, files, dir(+include/exclude_tags)} + env | `run_flow` | Validate mutual exclusivity; per-step results |
| `inspect_screen` | device_id | `inspect_screen` | Compact hierarchy JSON (ui_schema + elements); a11y→text selector caveat |
| `cheat_sheet` | — | `cheat_sheet` | Served from bundled `assets/maestro-cheat-sheet.yaml` (offline) |
| `list_devices` | — | `device_list` | merged |
| `take_screenshot` | device_id | `screenshot` | merged |
| `run_on_cloud` / `get_cloud_run_status` / `list_cloud_devices` | … | **deferred (v2)** | Cloud not used in this workspace |
| `open_maestro_viewer` | — | **deferred (v2)** | Viewer URL only |

## Source 3: react-native-debugger MCP (`@twodoorsdev/react-native-debugger-mcp`)

| Source tool | Params | podium tool | Notes |
|---|---|---|---|
| `getConnectedApps` | metroServerPort | `metro_apps` | GET `http://localhost:<port>/json` (CDP targets) |
| `readConsoleLogsFromApp` | app {id, description, webSocketDebuggerUrl}, maxLogs=100 | `metro_logs` | WS to debugger URL, Runtime.enable, collect consoleAPICalled |

## podium-only additions (session learnings)

| Tool | Why |
|---|---|
| `set_location` (udid, lat, lon) | QA3 geo-spinner fix — `xcrun simctl location <udid> set lat,lon` |
| `app_state` (udid, bundleId) | installed/running/foreground check before flows |
| `podium_health` | toolchain detection (xcrun/maestro/adb) |

## Known limits (documented, not worked around)

- Maestro idb flakiness ("Failed to connect to 127.0.0.1") → retry w/ backoff ≥2, then surface a structured error advising device reboot.
- WebGL canvas content is un-automatable (no DOM/hierarchy) — `inspect_screen` returns the native layer only.
- No Android SDK in this workspace — all adb paths degrade to a structured "adb not found" result.
- WebView content-process memory is unreadable from the app sandbox (see `mobile/docs/MOBILE_E2E.md`).

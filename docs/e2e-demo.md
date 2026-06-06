# End-to-end verification transcript

> Recorded 2026-06-06 against booted iPhone 16 Pro simulator `74DD7D29-38BC-4B82-B92A-FFA7E0C15F74`,
> The Win Zone (`com.playstudios.thewinzone`) installed and running, Metro live on :8081.
> All calls made through the real MCP stdio server (`node dist/index.js`), not the underlying CLIs.

## 1. podium_health

```json
{ "name": "podium-mcp", "version": "0.1.0",
  "toolchain": { "xcrun": true, "maestro": true, "adb": false } }
```

adb absent → reported, not fatal.

## 2. set_location (QA geo-spinner fix)

```json
{ "ok": true, "udid": "74DD7D29-…", "latitude": 30.2672, "longitude": -97.7431 }
```

## 3. screenshot

```json
{ "ok": true, "path": "/tmp/podium-verify-1.png", "byteSize": 342172 }
```

## 4. app_state

```json
{ "installed": true, "running": true }
```

## 5. metro_apps

```json
[ { "id": "b499ff3f…-1", "description": "React Native Bridgeless [C++ connection]",
    "title": "com.playstudios.thewinzone (iPhone 16 Pro)",
    "webSocketDebuggerUrl": "ws://localhost:8081/inspector/debug?…" } ]
```

## 6. metro_logs — real CDP log capture

```json
{ "chosenApp": "com.playstudios.thewinzone (iPhone 16 Pro)", "count": 10,
  "logs": [
    { "level": "log", "text": "[WEB_LOG] [APP LOG]: [Redux][Popup]: {\"type\":\"loyaltyweb/popup/GET_TRIGGER_IDS\"…}" },
    { "level": "warning", "text": "This method is deprecated (… React Native Firebase …" } ] }
```

Real Redux bridge traffic from the WebView captured through `Runtime.consoleAPICalled`.

## 7. inspect_screen — Maestro hierarchy

Returned the full native view hierarchy; root child carries
`accessibilityText: "The Win Zone"`, bounds `[0,0][402,874]`.

## 8. tap_on — ephemeral flow, point mode

```json
{ "ok": true, "cmd": "tapOn", "selector": "{ point: \"201,437\" }", "retries": 0 }
```

Before/after screenshots: `/tmp/podium-tap-before.png` (347 919 B) → `/tmp/podium-tap-after.png` (349 018 B).
No idb retry needed this run.

## 9. run_flow — file mode, truthful failure

`mobile/.maestro/smoke.yaml` ran end-to-end: `launchApp COMPLETED`, ATT conditional `SKIPPED`,
then `Assert "Log In" visible → FAILED` — **expected**: the app was already logged in (qa38 session),
so the logged-out assertion cannot match. The tool surfaced the real per-step outcome and maestro
debug-artifact path instead of masking it.

## 10. run_flow — inline yaml, green path

```json
{ "ok": true, "passed": true, "retries": 0, "durationMs": 11491,
  "rawOutput": "… Launch app \"com.playstudios.thewinzone\" without stopping app... COMPLETED\nAssert that \"The Win Zone\" is visible... COMPLETED" }
```

`launchApp: { stopApp: false }` confirmed — app foregrounded without a restart.

## 11. crash_list

26 real `.ips` entries parsed from `~/Library/Logs/DiagnosticReports` (newest-first, process names + sizes).

---

# Acceptance run for project "mobile" (2026-06-06) — 28 tools, 5 capability buckets

> Validates the 5 stated requirements live against The Win Zone on sim 74DD7D29. Unit: 61/61 vitest. Build clean.

## #1 Read all info from device
- `podium_health` → `{xcrun:true, maestro:true, adb:false}`
- `screen_size` → `{widthPx:1206, heightPx:2622}` (real iPhone 16 Pro)
- `orientation_get` → `{orientation:"portrait", basis:"screenshot-aspect-ratio"}`
- `app_list` → count 20, includes `{bundleId:"com.playstudios.thewinzone", name:"The Win Zone", type:"User"}`
- `app_state` → `{installed:true, running:true}`

## #2 Control device
- `set_location` 30.2672,-97.7431 → ok (geo-spinner fix)
- `press_key` "volume up" → flow passed (1st attempt flaky/transient, passed on retry)
- `tap_on` point (201,700) → tapOn passed
- `orientation_set` PORTRAIT → flow passed

## #3 Screenshot / capture
- `screenshot` → /tmp/podium-e2e-info.png, 824145 bytes
- `record_start` (pid 37629) → `record_stop` → /tmp/podium-e2e-rec.mp4, 120263 bytes, `file` confirms "ISO Media, Apple QuickTime movie"

## #4 Make e2e
- `run_flow` inline (launchApp stopApp:false + assertVisible "The Win Zone") → passed, 9599ms, per-step results returned
- `inspect_screen` → native hierarchy (root a11y "The Win Zone")

## #5 Everything behind one connection
- Device / app / screenshot / gesture / orientation / recording / crash — all present
- Flows: `run_flow` / `inspect_screen` / `cheat_sheet` — present
- RN debugging: `metro_apps` (finds the app bridge), `metro_logs` (real RN Firebase deprecation warnings captured via CDP) — present

## Harness note
`record_start`+`record_stop` fired in one un-awaited batch raced (record_stop saw empty registry). Re-run with a sequential one-process driver (await each response) → full lifecycle passed. Real MCP clients serialize, so this is a test-harness artifact, now documented as a usage constraint in README.

<div align="center">

# 🎙️ podium-mcp

**One baton. Every instrument.**

A single stdio endpoint with **34 tools** for iOS-simulator device control, native UI automation, end-to-end flows, React Native debugging, and WebView DOM inspection — one connection instead of several.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![MCP](https://img.shields.io/badge/MCP-stdio-7C3AED)](https://modelcontextprotocol.io)
[![Tests](https://img.shields.io/badge/tests-66%20passing-brightgreen.svg)](#development)
[![CI](https://github.com/hoainho/podium-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/hoainho/podium-mcp/actions/workflows/ci.yml)

<br/>

<img src="assets/demo.gif" alt="podium-mcp agent session — one prompt opens Safari on a live iOS simulator, types github.com/hoainho, explores the profile and opens a repository" width="300" />

<sub><i>One prompt → podium drives Safari live → types the URL → explores the profile → opens a repo. Footage captured on a live iPhone 16 Pro simulator.</i></sub>

</div>

---

A podium is where a maestro stands — one place to conduct the whole orchestra. This MCP server unifies four capability sets into a single stdio endpoint: **device management** (via `simctl`, with graceful `adb` support); **native UI inspection, interaction, and declarative end-to-end flows** (gestures route through `idb`/`mobilecli` with a Maestro fallback); **WebView DOM inspection** (via `mobilecli` over CDP); and **React Native debugging** (Metro console logs over CDP + crash reports). Rather than wiring several separate MCP servers into every client config, `podium-mcp` exposes everything behind one connection, with a shared exec layer, consistent error handling, and a single health-check tool to confirm what toolchain is available on the host machine.

## Table of contents

- [Why](#why)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Prompt playbook](#prompt-playbook)
- [Capability coverage](#capability-coverage-the-5-requirements)
- [Tool reference](#tool-reference-34-tools)
- [Documented limits](#documented-limits-by-design-not-bugs)
- [Architecture](#architecture)
- [Development](#development)
- [Full tool catalog](#full-tool-catalog)
- [Verified end-to-end](#verified-end-to-end)
- [Design ideas](#design-ideas)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Why

Driving a React Native app end-to-end usually means juggling three MCP servers —
one for device/app control, one for UI flows, one for Metro/debugger logs — each
with its own config entry, its own quirks, and its own failure modes. podium-mcp
collapses that into **one** server with:

- a single `execFile`-based command runner (no shell — arguments are passed verbatim),
- consistent structured errors (a tool never crashes the server),
- automatic retry around Maestro's known iOS-driver flakiness,
- graceful degradation when a toolchain (e.g. `adb`) is absent.

## Requirements

- **macOS** with Xcode command-line tools (`xcrun`, `simctl`)
- **Node.js ≥ 22** (uses native `fetch` and `WebSocket`)
- **`mobilecli`** — bundled automatically as an npm dependency; the default native gesture + WebView backend (no separate install)
- *(optional)* **[`idb`](https://fbidb.io)** (`idb` + `idb_companion`) — preferred native gesture backend when both are present; auto-detected
- *(optional)* **[Maestro](https://maestro.mobile.dev)** on `PATH` (or at `~/.maestro/bin`) — the `run_flow` engine and the gesture fallback path
- *(optional)* Android SDK + `adb` — adb paths degrade gracefully when absent
- *(optional)* a running Metro bundler for the `metro_*` debugging tools

## Claude Code plugin

Install podium-mcp as a Claude Code plugin — no manual config needed. One-time marketplace setup, then install:

```
/plugin marketplace add github:hoainho/podium-mcp
/plugin install podium-mcp@podium
```

Once installed, four skills are available directly in Claude Code:

| Skill | Invoke | What it does |
|---|---|---|
| Device info | `/podium-mcp:device-info <UDID> [<BUNDLE_ID>]` | Health check, screen size, orientation, app list |
| E2E flow | `/podium-mcp:e2e <UDID> <BUNDLE_ID> [path or description]` | Run or author a Maestro flow |
| Bug repro | `/podium-mcp:bug-repro <UDID> <BUNDLE_ID> <description>` | Video + logs + crash evidence capture |
| RN debug | `/podium-mcp:rn-debug [UDID] [logs\|apps\|crash\|all]` | Metro logs, connected apps, crash reports |

The plugin auto-starts the MCP server (all 34 tools) when enabled. No `.mcp.json` edits required.

> **To submit this plugin to the Claude community marketplace** (for discovery without the `marketplace add` step), run `claude plugin validate .` then submit via the Console form:
> [platform.claude.com/plugins/submit](https://platform.claude.com/plugins/submit) — Team/Enterprise orgs use [claude.ai/admin-settings/directory/submissions/plugins/new](https://claude.ai/admin-settings/directory/submissions/plugins/new).

## Manual installation

```bash
git clone git@github.com:hoainho/podium-mcp.git
cd podium-mcp
npm install
npm run build
```

## Usage

Register the built server with any MCP client. **Claude Code** (`.mcp.json`):

```json
{
  "mcpServers": {
    "podium": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/podium-mcp/dist/index.js"]
    }
  }
}
```

Quick manual smoke test over raw stdio (lists the registered tools):

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node dist/index.js
```

Then call `podium_health` first to confirm which toolchain is available on the host.

## Prompt playbook

Copy-paste prompts for common React Native testing & debugging tasks — e2e flows,
test cases, feature verification, bug fixing, and device control — live in
[`prompts/`](prompts/). Each prompt names the podium tools it drives and was
validated against a real simulator. Start with
[`prompts/README.md`](prompts/README.md).

## Capability coverage (the 5 requirements)

| # | Requirement | podium tools | Verified on a real RN app |
|---|---|---|---|
| 1 | Read all info from device | `device_list`, `screen_size`, `orientation_get`, `app_list`, `app_state`, `podium_health` | ✅ screen 1206×2622, `app_list` resolves bundle id + name |
| 2 | Control device | `app_launch/terminate/install/uninstall`, `tap_on`, `swipe`, `input_text`, `press_key`, `set_location`, `orientation_set`, `open_url` | ✅ tap, key, location, orientation all pass |
| 3 | Screenshot / capture | `screenshot`, `record_start`/`record_stop` (video) | ✅ PNG + QuickTime `.mp4` |
| 4 | Make e2e | `run_flow`, `inspect_screen`, `cheat_sheet` + gestures | ✅ flow pass with per-step results |
| 5 | Everything behind one connection | all 34 tools below — device, automation, capture, debugging, and WebView inspection in a single endpoint | ✅ see [tool catalog](docs/tool-catalog.md) |

## Tool reference (34 tools)

| Tool | Key params | Backing engine | Failure behavior |
|---|---|---|---|
| `podium_health` | — | `which` probes | Never fails; booleans for xcrun / maestro / adb |
| `device_list` | — | `simctl list --json` + `adb devices` | adb absent → `android: { available: false }` (graceful) |
| `device_boot` | udid | `simctl boot` | Structured tool error |
| `app_install` | udid, path | `simctl install` | Structured tool error |
| `app_launch` | udid, bundleId | `simctl launch` | Structured tool error |
| `app_terminate` | udid, bundleId | `simctl terminate` | Structured tool error |
| `screenshot` | udid, saveTo? | `simctl io screenshot` | Returns path + byteSize (no base64 bloat) |
| `open_url` | udid, url | `simctl openurl` | Structured tool error |
| `set_location` | udid, latitude, longitude | `simctl location set` | Codifies the QA geo-spinner fix |
| `app_state` | udid, bundleId | `simctl listapps` + `launchctl list` | `{ installed, running }` |
| `app_list` | udid | `simctl listapps` + `plutil` JSON | `{ count, apps: [{bundleId, name, type}] }` |
| `app_uninstall` | udid, bundleId | `simctl uninstall` | Structured tool error |
| `screen_size` | udid | `simctl io screenshot` + `sips` | `{ widthPx, heightPx }` (real pixels) |
| `orientation_get` | udid | native query (`mobilecli`/`idb`) → screenshot fallback | `{ orientation, basis }` (exact when native; heuristic otherwise) |
| `orientation_set` | udid, bundleId, value | native (`mobilecli`) → Maestro fallback | PORTRAIT / LANDSCAPE_LEFT / LANDSCAPE_RIGHT / UPSIDE_DOWN |
| `record_start` | udid, saveTo? (.mp4) | detached `simctl io recordVideo` | `{ ok, path, pid }`; one recording per udid |
| `record_stop` | udid | SIGINT the recorder + flush | `{ ok, path, sizeBytes }` |
| `inspect_screen` | udid, compact? | native flat AX list (`idb`/`mobilecli`) → `maestro hierarchy` | `compact:true` (default) returns only meaningful nodes |
| `tap_on` | udid, bundleId, text\|id\|x+y, double?, long? | native tap (`idb`/`mobilecli`) → Maestro fallback | text/id resolved via the element list; reports `backend` |
| `input_text` | udid, bundleId, text, submit? | native (`idb`/`mobilecli`) → Maestro fallback | reports `backend` |
| `swipe` | udid, bundleId, direction, start/end? | native (`idb`/`mobilecli`) → Maestro fallback | %/pixel overrides resolved vs logical screen size |
| `press_key` | udid, bundleId, key | native (`idb`/`mobilecli`) → Maestro fallback | back/power/tab are Android-only |
| `tap_with_fallback` | udid, x, y, bundleId?, maxRetries?, offsetStep? | native tap + before/after screenshot diff | Retries at `y - offsetStep` until the screen changes; for WebGL/Canvas overlays |
| `notification_bar_clear` | udid, bundleId? | native tap at (50,850) + screenshot diff | Dismisses the RN debug notification bar |
| `run_flow` | udid + exactly one of yaml/files/dir(+tags), env? | `maestro test` | Exactly-one-of validated before exec; per-step results |
| `cheat_sheet` | — | bundled `assets/maestro-cheat-sheet.yaml` | Fully offline |
| `webview_inspect` | udid, selector?, webviewId?, max? | `mobilecli` (CDP) | Resolves a CSS selector to DOM elements with absolute `tapX`/`tapY` for `tap_on`; first visible WebView when `webviewId` omitted |
| `webview_eval` | udid, expression, webviewId? | `mobilecli` (CDP) | Evaluates JS in the WebView page context (read `location.href`, store state, balances) |
| `webview_navigate` | udid, action (`goto`\|`back`\|`forward`\|`reload`), url?, webviewId? | `mobilecli` (CDP) | Drives WebView navigation |
| `metro_apps` | port? (8081) | GET `http://localhost:<port>/json` | Metro down → structured `metro not running` |
| `metro_logs` | webSocketDebuggerUrl? / port?, durationMs?, maxLogs? | native WebSocket + CDP `Runtime.enable` | Auto-discovers first app when URL omitted |
| `crash_list` | processName?, sinceHours?, udid? | `~/Library/Logs/DiagnosticReports` + sim container | Empty list when dir unreadable |
| `crash_get` | id, udid? | same | Path-traversal-safe (basename only); truncates honestly |

> **WebView tools** (`webview_inspect`/`eval`/`navigate`) use the bundled `mobilecli` over CDP — not the idb or Maestro paths — and require the app's `WKWebView.isInspectable = true` (default in debug/staging builds; usually disabled in production App Store builds).

### Native-first gesture backend

Imperative gestures (`tap_on`, `input_text`, `swipe`, `press_key`, `orientation_set`) and `inspect_screen` route through the fastest available backend, probed once and cached:

1. **`idb`** — used when both `idb` and `idb_companion` are installed (native, fastest).
2. **`mobilecli`** — the bundled npm dependency (prebuilt Go binary). Default backend; no install needed.
3. **Maestro fallback** — when no native backend resolves, or for actions a native backend can't express (double/long-press, `UPSIDE_DOWN`). The gesture generates a minimal flow with `launchApp: { stopApp: false }`, foregrounding the app **without restarting** so state is preserved.

Each result reports the `backend` it used. Set `PODIUM_DISABLE_NATIVE=1` to force the Maestro path. Eliminating the per-gesture JVM spin-up cut `tap_on` from ~14.7 s to ~0.6 s and `inspect_screen` from ~8.9 s to ~0.9 s on an iPhone 16 Pro simulator. Run `npm run benchmark` for a full 33-tool pass/fail sweep.

### Maestro fallback — idb flakiness retry

When the Maestro fallback path runs, its iOS driver intermittently fails with `Failed to connect to 127.0.0.1:<port>` / `java.net.ConnectException`. Flow executions automatically retry up to **2 times with 2s / 5s backoff** and report the `retries` count. If it persists, the structured failure includes the raw output — the usual remedies are rebooting the simulator (`device_boot` after shutdown) or restarting the Maestro daemon.

## Documented limits (by design, not bugs)

- **WebGL/Canvas content is un-automatable by selector** — no DOM/hierarchy; use `tap_with_fallback` with screenshot-derived coordinates.
- **`inspect_screen` sees only the native layer for WebView content** — use `webview_inspect` to resolve `WKWebView` DOM elements to tap coordinates (requires `isInspectable = true`).
- **WebView tools are dev/QA only** — production App Store builds typically set `WKWebView.isInspectable = false`.
- **No Android SDK assumption** — every adb-backed path degrades to a structured "adb not found" result instead of failing.
- **WebView content-process memory is unreadable** from the app sandbox (iOS/Android platform limit) — use indirect signals (memory warnings, process terminations).
- **Maestro `text:` matcher is full-string regex (IGNORE_CASE)** — partial strings don't match; copy hierarchy `text` verbatim or anchor with `.*`.
- **`record_start`/`record_stop` keep recorder state in-process** (one Map per udid, server is long-lived). Clients must serialize `start` → … → `stop` on the same connection; firing both in one un-awaited batch races. One active recording per udid.

## Architecture

```
src/
  index.ts          # MCP server entry — registers every tool group, warms caches
  lib/
    exec.ts         # execFile-based command runner (NO shell) + commandExists
    result.ts       # shared ok/error MCP content helpers
    simctl.ts       # xcrun simctl wrappers + device-list TTL cache
    native.ts       # gesture/inspect backend abstraction: idb → mobilecli → null
    idb.ts          # idb gesture/inspect adapter
    gesture.ts      # nativeTap hybrid (backend → Maestro fallback)
    maestro.ts      # Maestro engine: flow runner, idb retry, hierarchy
    webview.ts      # mobilecli CDP — WebView list/inspect/eval/navigate
    metro.ts        # Metro CDP — app discovery + console log capture
    crash.ts        # DiagnosticReports crash listing/reading
    recording.ts    # detached screen recording lifecycle
  tools/            # one file per group (health, device, screen, flow, debug, webview)
assets/             # bundled offline Maestro cheat sheet
scripts/            # benchmark.ts (33-tool e2e), compare-mcps.ts
docs/               # tool catalog + e2e transcript
```

## Development

```bash
npm run build       # tsc
npm run typecheck   # tsc --noEmit
npm test            # vitest run (61 tests; exec/network layer mocked — no sim needed)
```

Standards: TypeScript strict, **no `as any` / `@ts-ignore`**, **no shell execution**
(all commands via `lib/exec.ts`), tools return structured errors instead of throwing.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide and the "add a new tool" checklist.

## Full tool catalog

See [`docs/tool-catalog.md`](docs/tool-catalog.md) for the authoritative tool-by-tool reference — every tool with its parameters, backing engine, and fallback behavior, plus the items deferred to a future version (cloud execution, live viewer).

## Verified end-to-end

See [`docs/e2e-demo.md`](docs/e2e-demo.md) for a real transcript against a booted iPhone 16 Pro simulator running a production React Native app.

> **Platform note:** macOS + iOS Simulator is the primary target. Android degrades gracefully — tools check for `adb` at runtime and return informative errors when the Android SDK is absent rather than failing hard.

## Design ideas

podium-mcp is built around a few deliberate principles:

- **One podium, one connection.** A single server fronts every mobile capability — device, UI, flows, capture, debugging, and WebView inspection — so an agent configures one endpoint and discovers all 34 tools at once, instead of stitching together several servers.
- **Safe by construction.** Every external command runs through an `execFile` layer with an explicit argument array — never a shell string — so tool inputs (udids, paths, selectors, flow YAML) can't be interpreted as commands.
- **Never crash the conductor.** Tools return structured results and errors instead of throwing; one bad call can't take the server down.
- **Degrade, don't fail.** A missing toolchain (e.g. Android's `adb`) yields an informative result rather than a hard error.
- **Resilient automation.** Flaky simulator drivers are retried with backoff, and every result reports exactly what happened (including the retry count).

### How to use it, in order

1. **`podium_health`** — confirm `xcrun` and `maestro` are available on the host.
2. **`device_list`** — pick a booted simulator `udid`.
3. **Read state** — `app_list`, `app_state`, `screen_size`, `orientation_get`.
4. **Drive the device** — `app_launch`, then `tap_on` / `input_text` / `swipe` / `press_key`, plus `set_location` and `orientation_set`.
5. **Author end-to-end checks** — `inspect_screen` to discover element text/ids, then `run_flow` (inline YAML or a `.maestro` file).
6. **Capture & debug** — `screenshot` or `record_start` → `record_stop` for video; `metro_logs` for live RN console output; `crash_list` / `crash_get` for diagnostics.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and our
[Code of Conduct](CODE_OF_CONDUCT.md). Use the issue templates for bugs and
feature requests.

## Security

Please report vulnerabilities privately per [SECURITY.md](SECURITY.md) — do not
open a public issue.

## License

[MIT](LICENSE) © 2026 hoainho

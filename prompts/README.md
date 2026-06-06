# 📋 podium-mcp prompt playbook

Copy-paste prompts that drive **podium-mcp** to test and debug React Native apps
on an iOS simulator — e2e flows, test cases, feature verification, bug fixing,
and device control. Paste any prompt into an agent that has podium connected
(e.g. Claude Code), fill the placeholders, and let it run the tools.

> **Every prompt below was validated end-to-end** on a booted iPhone 16 Pro
> simulator (iOS 18.5) running a production RN app on **2026-06-06** — the exact
> podium tool sequences each prompt relies on returned `isError=false` live.
> See [`../docs/e2e-demo.md`](../docs/e2e-demo.md) for the raw transcript.

## Prerequisites

- podium registered in your MCP client (`.mcp.json`):
  ```json
  { "mcpServers": { "podium": { "type": "stdio", "command": "node", "args": ["/abs/path/to/podium-mcp/dist/index.js"] } } }
  ```
- macOS + a **booted** iOS simulator, `maestro` installed.
- For RN debugging prompts: the app's **Metro** bundler running (usually `:8081`).

## How to use

1. Pick a prompt from a category below.
2. Replace the placeholders:
   - `<UDID>` — your simulator UDID
   - `<BUNDLE_ID>` — the app under test (e.g. `com.example.app`)
3. Paste it to your agent. It will call the named podium tools and report back.

### Step 0 — discover your IDs (run this first)

```text
Using podium, call device_list and show me the booted iOS simulators (udid + name).
Then call app_list for that udid and show me the User apps (bundleId + name) so I
can pick the app under test. Finally call podium_health and confirm xcrun + maestro
are available.
```

## Categories

| File | What it covers |
|---|---|
| [01 · Device control](01-device-control.md) | Boot, info (screen/orientation/apps), location, rotate, install/launch/terminate, deep links |
| [02 · E2E flows](02-e2e-flows.md) | Run smoke flows, author flows from acceptance criteria, record a run as video |
| [03 · Test cases](03-test-cases.md) | Turn acceptance criteria / tickets into runnable Maestro test cases & suites |
| [04 · Feature development](04-feature-development.md) | Verify a new feature on device, step screenshots, before/after checks |
| [05 · Bug fixing](05-bug-fixing.md) | Reproduce crashes/black-screens, capture logs+video+crash reports, repro-first e2e |
| [06 · RN debugging](06-rn-debugging.md) | Stream Metro console logs, find & read crash reports, toolchain health |

## Conventions used in every prompt

- Prompts name the **podium tools** to use, so the agent calls the right ones.
- Interaction tools (`tap_on`, `input_text`, `swipe`, `press_key`, `orientation_set`)
  need `<BUNDLE_ID>` — Maestro requires the app id in the flow header.
- Prefer `inspect_screen` to discover real element text/ids **before** tapping —
  don't guess from a screenshot.
- For anything that records or runs a flow, call the tools **in sequence** (await
  each result) — `record_start` → … → `record_stop` must be on one connection.

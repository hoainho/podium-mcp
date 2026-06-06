# Contributing to podium-mcp

Thanks for your interest in improving podium-mcp. This document covers the dev
setup, coding standards, and the workflow for landing a change.

## Prerequisites

- **macOS** with Xcode command-line tools (`xcrun`, `simctl`)
- **Node.js ≥ 22** (the server uses native `fetch` and `WebSocket`)
- **[Maestro](https://maestro.mobile.dev)** on `PATH` (or at `~/.maestro/bin`) for the flow/interaction tools
- A booted iOS Simulator for manual end-to-end verification
- *(optional)* Android SDK + `adb` — every adb path degrades gracefully when absent

## Setup

```bash
git clone git@github.com:hoainho/podium-mcp.git
cd podium-mcp
npm install
npm run build
npm test
```

## Project layout

```
src/
  index.ts          # MCP server entry — registers every tool group
  lib/
    exec.ts         # execFile-based command runner (NO shell) + commandExists
    result.ts       # shared ok/error MCP content helpers
    simctl.ts       # xcrun simctl wrappers (device + app + screen)
    maestro.ts      # Maestro engine: flow runner, idb retry, hierarchy
    metro.ts        # Metro CDP — app discovery + console log capture
    crash.ts        # DiagnosticReports crash listing/reading
    recording.ts    # detached screen recording lifecycle
  tools/            # one file per tool group (health, device, screen, flow, debug)
assets/             # bundled offline Maestro cheat sheet
docs/               # tool catalog + e2e transcript
```

## Coding standards (enforced)

- **TypeScript strict** — `npm run typecheck` must pass with zero errors.
- **No type suppression** — `as any` and `@ts-ignore` are not allowed. Model the types properly.
- **No shell execution** — always go through `lib/exec.ts` `run()` (uses `execFile`, arguments passed verbatim). Never build a shell string; this is a hard security rule.
- **Tools never throw** — return `errorResult(...)` from `lib/result.ts`. A tool handler must not crash the server.
- **No new runtime dependencies** without discussion — prefer Node built-ins.
- Match the existing file/style conventions of the module you are editing.

## Adding a new tool — checklist

1. Add the backing helper to the right `lib/*.ts` module (typed, never throws).
2. Register the tool in the matching `tools/*.ts` `register*Tools(server)` with a `zod` schema and a clear description.
3. Add unit tests (mock the exec/`fetch`/`WebSocket` layer — see existing `*.test.ts`).
4. Update the tool table in `README.md` and the catalog in `docs/tool-catalog.md`.
5. `npm run build && npm test` green, then add a manual-verification note if it touches a device.

## Tests

```bash
npm test            # vitest run (unit)
npm run typecheck   # tsc --noEmit
npm run build       # tsc
```

Unit tests mock the exec / network layer so they run without a simulator.
Device-touching behavior must additionally be verified manually on a booted
simulator and noted in the PR (see `docs/e2e-demo.md` for the format).

## Commits & PRs

- Keep commit subjects concise (≤ 72 chars) and imperative.
- One logical change per PR; keep diffs focused.
- Ensure `build`, `typecheck`, and `test` are green before opening a PR.
- Describe what you changed, why, and how you verified it.

## Reporting bugs / requesting features

Open an issue using the templates under `.github/ISSUE_TEMPLATE/`. For security
issues, **do not** open a public issue — see [`SECURITY.md`](SECURITY.md).

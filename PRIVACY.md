# Privacy Policy

**Last updated: 2026-06-13**

Podium MCP (`podium-mcp`) is a local developer tool. It runs entirely on your
own machine as a stdio MCP server and does **not** collect, store, transmit, or
sell any personal data.

## What Podium does
- Executes local toolchains you already have installed — `xcrun`/`simctl`,
  `mobilecli`, and (optionally) `idb` and `maestro` — against iOS simulators and
  apps **on your own machine**.
- Produces artifacts (screenshots, screen recordings, view hierarchies, console
  and crash logs) that are written **only to your local filesystem**. Podium
  never uploads them anywhere.

## Data collection
- **None.** Podium has no telemetry, no analytics, and no backend server. It
  does not phone home and has no author-controlled endpoint.

## Third-party components
- Podium is distributed on the npm registry; installing or running it via
  `npx`/`npm` downloads the package and its dependencies from npm, governed by
  [npm's privacy policy](https://docs.npmjs.com/policies/privacy).
- It invokes third-party tools (`mobilecli`, Maestro, idb, Xcode `simctl`) that
  operate locally and are governed by their own respective policies.
- WebView inspection evaluates JavaScript you direct it to run inside your own
  app's WebView, on your own device. No page data leaves your machine.

## Scope
- Podium targets **macOS + Xcode iOS simulators** for development and QA. It is a
  developer/QA tool, not an end-user application, and processes only the apps and
  devices you choose to operate.

## Contact
Questions: open an issue at
<https://github.com/hoainho/podium-mcp/issues>.

# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-06

### Added

- Initial release: a single MCP stdio server (`podium`) merging three mobile
  tool MCPs into **28 tools** with a shared `execFile` runner and consistent
  structured error handling.
- **Device & apps** (mobile-mcp parity): `device_list`, `device_boot`,
  `app_install`, `app_launch`, `app_terminate`, `app_uninstall`, `app_list`,
  `app_state`, `open_url`, `set_location`, `screen_size`, `orientation_get`.
- **UI interaction & flows** (Maestro engine): `inspect_screen`, `tap_on`,
  `input_text`, `swipe`, `press_key`, `orientation_set`, `run_flow`,
  `cheat_sheet` (bundled offline).
- **Capture**: `screenshot`, `record_start`, `record_stop`.
- **React Native debugging** (react-native-debugger parity): `metro_apps`,
  `metro_logs` (native CDP), `crash_list`, `crash_get` (host + simulator
  DiagnosticReports).
- `podium_health` toolchain detection (xcrun / maestro / adb).
- idb-flakiness retry with backoff for Maestro flows.
- Docs: `README.md`, `docs/tool-parity.md`, `docs/e2e-demo.md`.
- 61 unit tests (vitest); TypeScript strict; no type suppression.

[0.1.0]: https://github.com/hoainho/podium-mcp/releases/tag/v0.1.0

# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately to **nhoxtvt@gmail.com** with:

- a description of the issue and its impact,
- steps to reproduce (proof-of-concept if possible),
- the affected version/commit.

You can expect an acknowledgment within a few business days and a coordinated
fix/disclosure timeline.

## Security posture

podium-mcp executes local developer tooling (`xcrun`, `maestro`, `adb`) on
behalf of an MCP client. Two design rules guard against the most likely class
of issue:

- **No shell execution.** All commands run through `lib/exec.ts` `run()`, which
  uses `execFile` with an explicit argument array — arguments (udids, paths,
  bundle ids, selectors, flow YAML) are passed verbatim and are never parsed by
  a shell. Shell metacharacters in tool inputs are inert.
- **Path-traversal-safe file reads.** `crash_get` resolves only basenames within
  server-controlled DiagnosticReports directories.

Because the server runs arbitrary Maestro flows and controls a simulator, run
it only against trusted MCP clients and trusted flow content.

## Trust boundary — agent-controlled code execution

Two tools intentionally expose local code execution to the connected MCP client.
This is by design, not a vulnerability, but operators must understand the blast
radius:

- **`webview_eval`** evaluates arbitrary JavaScript in an inspectable WebView's
  page context. Whoever drives the server can read `localStorage`/`document.cookie`,
  call authenticated XHR as the logged-in user, or exfiltrate DOM state. Most
  production App Store builds disable this (WKWebView `isInspectable=false`),
  which is the natural mitigation.
- **`run_flow`** executes Maestro flows, whose language includes `evalScript`
  (inline JS) and `runScript`/`files`/`dir` (run local script files). Granting
  `run_flow` is effectively granting local code execution scoped to Maestro's
  capabilities.

For locked-down deployments, set `PODIUM_DISABLE_WEBVIEW_EVAL=1` to refuse
`webview_eval`, and only point `run_flow` at vetted flow directories.

## Sensitive data in tool output

`webview_eval`, `webview_inspect`, and `metro_logs` return raw page/console state
(which can include auth tokens, input values, balances) directly into the MCP
result. That output may be persisted in the client's transcript or session
archive. Treat all WebView/console output as potentially sensitive and avoid
persisting it unredacted.

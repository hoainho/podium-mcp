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

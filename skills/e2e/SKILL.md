---
description: Run or author a Maestro E2E flow on an iOS simulator. Usage: /podium-mcp:e2e <UDID> <BUNDLE_ID> [<flow-path-or-description>]
---

You are running an end-to-end Maestro flow via podium. Parse `$ARGUMENTS` as:
- token 1 → UDID
- token 2 → BUNDLE_ID
- remaining text → either a file path (ends in .yaml/.yml) or a plain-language description of the journey to author

**If a file path was given:**
Call `run_flow` with `udid` and `files: [<path>]`. Report every step's pass/fail. If any step fails, quote the relevant raw output lines.

**If a description was given (or nothing):**
1. Call `inspect_screen` on the UDID to enumerate tappable elements and their exact text/ids.
2. Author an inline Maestro YAML that only uses selectors you actually observed — never invent text. The flow must start with `appId: <BUNDLE_ID>` and `launchApp: {stopApp: false}`.
3. Call `run_flow` with the inline `yaml`.
4. Report each step result. If it fails, revise the flow once using the error and re-run.

Always show the per-step `steps` array in your response, not just a top-level pass/fail.

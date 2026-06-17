---
description: "Reproduce a bug with full evidence capture — video, Metro logs, and crash report. Usage: /podium-mcp:bug-repro <UDID> <BUNDLE_ID> <bug-description>"
---

Parse `$ARGUMENTS` as:
- token 1 → UDID
- token 2 → BUNDLE_ID
- remaining text → bug description / repro steps

Execute in this exact order (await each call):

1. `record_start` — saveTo `/tmp/repro-<BUNDLE_ID>.mp4`
2. `inspect_screen` on the UDID — capture the starting state
3. Author and call `run_flow` with an inline Maestro YAML that encodes the repro steps. Use only selectors from step 2.
4. `record_stop`
5. `metro_logs` — durationMs 4000, maxLogs 100 — capture console output around the repro
6. `crash_list` — udid UDID, sinceHours 1 — check for new crashes

**Summarize:**
- Did the bug reproduce? (REPRODUCED / NOT REPRODUCED / INCONCLUSIVE)
- Video path + sizeBytes from record_stop
- Relevant log lines (errors/warnings only)
- Any new crash entry (exception type + top frame)
- Root-cause hypothesis with evidence

If Metro is not running, note it and skip step 5 — do not fail the whole repro.

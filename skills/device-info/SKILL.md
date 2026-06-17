---
description: "Gather full device info from an iOS simulator — toolchain health, screen size, orientation, installed apps, and app state. Usage: /podium-mcp:device-info <UDID> [<BUNDLE_ID>]"
---

Using podium, gather a complete snapshot of the iOS simulator `$ARGUMENTS` (format: `<UDID> [<BUNDLE_ID>]`). Parse the first token as UDID and optional second as BUNDLE_ID.

Call these tools in parallel where possible, then summarize as a table:

1. `podium_health` — toolchain status (xcrun, maestro, adb)
2. `screen_size` with the UDID — pixel dimensions
3. `orientation_get` with the UDID — portrait/landscape
4. `app_list` with the UDID — show only User apps (not system)
5. If BUNDLE_ID was provided: `app_state` for that bundle — installed / running / not installed

Present results as a markdown table. Flag any toolchain issues (missing xcrun or maestro) with a one-line remediation hint.

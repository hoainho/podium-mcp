# 01 · Device control for testing

Prompts to inspect and drive the simulator itself. Replace `<UDID>` / `<BUNDLE_ID>`.

---

### List & boot a simulator
**Tools:** `device_list`, `device_boot` · ✅ verified

```text
Using podium, call device_list and show the iOS simulators with their state.
If "<UDID>" is not Booted, call device_boot for it and confirm it comes up.
```

---

### Read everything about the device
**Tools:** `screen_size`, `orientation_get`, `app_list`, `app_state`, `podium_health` · ✅ verified

```text
Using podium on udid <UDID>, gather device info and summarize it as a table:
- podium_health (toolchain)
- screen_size (pixels)
- orientation_get (portrait/landscape)
- app_list (just the User apps)
- app_state for <BUNDLE_ID> (installed / running)
```

---

### Unblock a location-gated feature (geo-spinner fix)
**Tools:** `set_location` · ✅ verified

```text
Using podium, call set_location on udid <UDID> with latitude 30.2672, longitude
-97.7431 (Austin, TX) to satisfy the app's location gate, then launch <BUNDLE_ID>
with app_launch and tell me if it gets past the location check.
```

---

### Rotate the device
**Tools:** `orientation_set`, `orientation_get`, `screenshot` · ✅ verified

```text
Using podium on udid <UDID> (app <BUNDLE_ID>): call orientation_set to
LANDSCAPE_LEFT, take a screenshot, then orientation_get to confirm, then
orientation_set back to PORTRAIT. Report whether the app actually rotated or is
orientation-locked.
```

---

### Install / launch / terminate / uninstall
**Tools:** `app_install`, `app_launch`, `app_terminate`, `app_uninstall`, `app_state` · ✅ verified (launch/terminate/state)

```text
Using podium on udid <UDID>:
1. app_state for <BUNDLE_ID> — is it installed?
2. If installed, app_launch it, confirm running via app_state, then app_terminate.
(If you need a fresh install: app_install with the .app/.zip path, then relaunch.)
```

---

### Open a deep link / URL
**Tools:** `open_url` · ✅ verified (simctl openurl)

```text
Using podium, call open_url on udid <UDID> with "<YOUR_DEEPLINK_OR_URL>" and then
inspect_screen to confirm the app routed to the expected screen.
```

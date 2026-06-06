# 04 · Feature development & verification

Prompts to verify a feature you're building, directly on the device. Replace
`<UDID>` / `<BUNDLE_ID>`.

---

### Verify a new feature on device (step screenshots)
**Tools:** `inspect_screen`, `tap_on`, `screenshot` · ✅ verified

```text
Feature: "<DESCRIBE THE NEW FEATURE / SCREEN>".

Using podium on udid <UDID> for <BUNDLE_ID>, walk the feature step by step:
for each step — inspect_screen to find the element, tap_on it (by text/id),
then screenshot to "/tmp/feat-step-<n>.png". At the end, list each step, the
element you acted on, and the screenshot path. Stop and report if any step's
element isn't in the hierarchy.
```

---

### Before/after visual check
**Tools:** `screenshot`, `tap_on` · ✅ verified

```text
Using podium on udid <UDID> for <BUNDLE_ID>: screenshot to "/tmp/before.png",
perform "<THE ACTION>" via tap_on / input_text, then screenshot to
"/tmp/after.png". Tell me both paths + byte sizes so I can diff them.
```

---

### Exercise a brand-new screen
**Tools:** `open_url`, `inspect_screen`, `tap_on` · ✅ verified

```text
Using podium on udid <UDID>: open_url "<DEEPLINK TO THE NEW SCREEN>" for
<BUNDLE_ID>, inspect_screen to confirm the new screen rendered, then tap_on each
interactive element once and report what each one does (re-inspect after each tap).
```

---

### Fill a form on the new feature
**Tools:** `inspect_screen`, `input_text`, `tap_on` · ✅ verified

```text
Using podium on udid <UDID> for <BUNDLE_ID>: inspect_screen to find the form
fields, input_text into each one ("<FIELD>: <VALUE>", …), tap_on the submit
button, then assert (run_flow assertVisible) that "<SUCCESS MARKER>" appears.
```

---

### Confirm a feature behind a location/permission gate
**Tools:** `set_location`, `app_launch`, `inspect_screen` · ✅ verified

```text
Using podium on udid <UDID>: set_location to <LAT>,<LON>, app_launch <BUNDLE_ID>,
then inspect_screen to confirm the gated feature "<FEATURE>" is now reachable.
```

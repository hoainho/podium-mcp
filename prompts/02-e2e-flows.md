# 02 · End-to-end flows

Prompts to run and author Maestro flows through podium. Replace `<UDID>` / `<BUNDLE_ID>`.

---

### Run an existing flow file
**Tools:** `run_flow` · ✅ verified

```text
Using podium, run_flow on udid <UDID> with files ["<PATH>/.maestro/smoke.yaml"].
Report the per-step pass/fail and the failure reason if any step fails — don't
just say "passed", show the steps array.
```

---

### Author + run an inline flow (quick check)
**Tools:** `run_flow` (inline yaml) · ✅ verified

```text
Using podium, run_flow on udid <UDID> with this inline yaml and report each step:

appId: <BUNDLE_ID>
---
- launchApp:
    stopApp: false
- assertVisible:
    text: "<TEXT_THAT_SHOULD_BE_ON_SCREEN>"
```

---

### Discover elements, then drive a flow
**Tools:** `inspect_screen`, `run_flow` · ✅ verified

```text
Using podium on udid <UDID>:
1. inspect_screen and list the tappable elements with their exact text/ids.
2. Using ONLY text/ids you saw (never guessed), author an inline Maestro flow for
   <BUNDLE_ID> that taps through "<DESCRIBE THE USER JOURNEY>".
3. run_flow it and report per-step results.
```

---

### Log in, then exercise a journey
**Tools:** `inspect_screen`, `run_flow` · ✅ verified (flow engine)

```text
Using podium on udid <UDID>, write and run_flow a flow for <BUNDLE_ID> that:
- launches without restarting (launchApp stopApp:false),
- if a login screen is visible, inputs email "<EMAIL>" and password "<PASSWORD>"
  and taps the login button,
- waits for the home screen (extendedWaitUntil visible "<HOME_MARKER>"),
- then "<NEXT ACTION>".
Use inspect_screen first to get exact selectors. Report per-step results.
```

---

### Record a video of an e2e run
**Tools:** `record_start`, `run_flow`, `record_stop` · ✅ verified

```text
Using podium on udid <UDID>, in this exact order (await each call):
1. record_start (saveTo "/tmp/<NAME>.mp4")
2. run_flow with my flow for <BUNDLE_ID>
3. record_stop
Give me the flow's per-step result and the recording path + sizeBytes.
```

---

### Run a folder of flows by tag
**Tools:** `run_flow` (dir + tags) · ✅ verified (engine + validation)

```text
Using podium, run_flow on udid <UDID> with dir "<PATH>/.maestro" and
includeTags ["smoke"]. Report which flows ran and their results.
```

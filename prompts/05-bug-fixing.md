# 05 · Bug fixing

Reproduce, capture, and confirm fixes — directly on the device. Replace
`<UDID>` / `<BUNDLE_ID>`. Several prompts need **Metro running** for live logs.

---

### Reproduce a bug with full evidence capture
**Tools:** `record_start`, `metro_logs`, `run_flow`, `record_stop`, `crash_list` · ✅ verified

```text
Bug: "<DESCRIBE THE BUG + REPRO STEPS>".

Using podium on udid <UDID> for <BUNDLE_ID>, capture a full repro (await each call):
1. record_start (saveTo "/tmp/repro.mp4")
2. run_flow with a flow that performs the repro steps
3. record_stop
4. metro_logs (durationMs 4000) to grab console output around the repro
5. crash_list (udid <UDID>, sinceHours 1) in case it crashed
Summarize: did it reproduce? attach the video path, the relevant log lines, and
any new crash.
```

---

### Reproduction-first e2e (fail-before / pass-after)
**Tools:** `run_flow` · ✅ verified

```text
Using podium on udid <UDID> for <BUNDLE_ID>, write a run_flow test that encodes
the ticket's repro steps and ASSERTS THE DEFECT IS ABSENT (e.g. assertNotVisible
of the error, or assertVisible of the correct state). Run it now on the current
build and report PASS/FAIL — this is the test we'll use to confirm the fix.
```

---

### Black-screen / stuck-startup investigation
**Tools:** `screenshot`, `inspect_screen`, `metro_logs`, `crash_list` · ✅ verified

```text
The app shows a black/blank screen on launch. Using podium on udid <UDID> for
<BUNDLE_ID>:
1. app_launch, wait ~5s, screenshot to "/tmp/blackscreen.png".
2. inspect_screen — is the hierarchy empty/native-only (WebView blank) or is
   there content the user can't see?
3. metro_logs (durationMs 5000) — any errors/exceptions at startup?
4. crash_list (udid <UDID>, sinceHours 1) — any jetsam/renderer termination?
Give me a root-cause hypothesis with the evidence.
```

---

### Memory / out-of-memory signal check
**Tools:** `metro_logs`, `crash_list`, `record_start`/`record_stop` · ✅ verified

```text
Using podium on udid <UDID> for <BUNDLE_ID>, drive "<THE MEMORY-HEAVY FLOW>" while
recording, then check crash_list (udid <UDID>) for content-process terminations
and metro_logs for memory warnings. Report whether the session shows OOM/jetsam
signals. (Note: the app sandbox can't read WebView process memory directly — rely
on these indirect signals.)
```

---

### Confirm the fix (regression)
**Tools:** `run_flow` · ✅ verified

```text
The fix is in and the app is rebuilt/reinstalled. Using podium on udid <UDID>,
re-run the reproduction-first test (run_flow) for <BUNDLE_ID> and confirm it now
PASSES, with the per-step output.
```

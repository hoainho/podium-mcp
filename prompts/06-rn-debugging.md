# 06 · React Native debugging

Metro console logs and crash diagnostics. Replace `<UDID>` / `<BUNDLE_ID>`.
Log prompts need the app's **Metro** bundler running (default port `8081`).

---

### Check the toolchain first
**Tools:** `podium_health` · ✅ verified

```text
Using podium, call podium_health and tell me whether xcrun, maestro, and adb are
available on this machine.
```

---

### Find the connected RN app on Metro
**Tools:** `metro_apps` · ✅ verified

```text
Using podium, call metro_apps (port 8081) and list the connected RN apps with
their title and webSocketDebuggerUrl. If it says "metro not running", remind me to
start the Metro bundler first.
```

---

### Stream console logs while I reproduce
**Tools:** `metro_logs` · ✅ verified

```text
Using podium, call metro_logs (durationMs 8000, maxLogs 100) and capture the RN
console output — I'll reproduce "<THE ACTION>" in the app during that window.
Then group the logs by level (log/warn/error) and call out anything suspicious.
```

---

### Capture logs around a specific tap
**Tools:** `tap_on`, `metro_logs` · ✅ verified

```text
Using podium on udid <UDID> for <BUNDLE_ID>: start metro_logs (durationMs 5000),
and within that window tap_on "<ELEMENT>". Report the log lines emitted by that
interaction.
```

---

### List recent crashes for the app
**Tools:** `crash_list` · ✅ verified

```text
Using podium, call crash_list with udid <UDID>, processName "<APP_PROCESS_NAME>"
(or the app name), sinceHours 48. Show the entries newest-first with their
source (host vs simulator) and dates.
```

---

### Read a specific crash report
**Tools:** `crash_list`, `crash_get` · ✅ verified

```text
Using podium, call crash_list (udid <UDID>) to find the most recent crash for
"<APP>", then crash_get that id (pass the same udid). Summarize the crash header
(exception type, termination reason) and the top frames of the body.
```

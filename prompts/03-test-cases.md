# 03 · Test cases from requirements

Turn acceptance criteria / tickets into runnable, repeatable Maestro test cases.
Replace `<UDID>` / `<BUNDLE_ID>`.

---

### One acceptance criterion → one test case
**Tools:** `inspect_screen`, `run_flow` · ✅ verified

```text
Acceptance criterion: "<PASTE AC VERBATIM>"

Using podium on udid <UDID> for app <BUNDLE_ID>:
1. inspect_screen to find the real selectors involved.
2. Author a Maestro flow that exercises exactly this AC and asserts the visible
   outcome (assertVisible / assertNotVisible) — the assertion must map 1:1 to the
   AC text, not just a network signal.
3. run_flow and report PASS/FAIL per step. If FAIL, show the failing assertion.
```

---

### Build a regression suite of flows
**Tools:** `run_flow` (dir) · ✅ verified

```text
Here are <N> acceptance criteria: "<PASTE LIST>".

Using podium for app <BUNDLE_ID> on udid <UDID>, draft one Maestro flow file per
criterion (tagged "regression"), save them under "<PATH>/.maestro/", then
run_flow with dir "<PATH>/.maestro" and includeTags ["regression"]. Give me a
results table: criterion → flow → PASS/FAIL.
```

---

### Data-driven test case (multiple inputs)
**Tools:** `run_flow` (env) · ✅ verified (engine + env passthrough)

```text
Using podium on udid <UDID>, run_flow my flow for <BUNDLE_ID> three times, each
with different env values (env: { USERNAME, AMOUNT }) for these cases: "<CASE 1>",
"<CASE 2>", "<CASE 3>". Report results per case.
```

---

### Negative / error-path test case
**Tools:** `inspect_screen`, `run_flow` · ✅ verified

```text
Using podium on udid <UDID> for <BUNDLE_ID>: author and run_flow a test case for
the ERROR path of "<FEATURE>" — e.g. invalid input — and assert the error message
"<EXPECTED ERROR TEXT>" is visible and the success state is NOT visible.
```

---

### Offline / flow-syntax helper
**Tools:** `cheat_sheet` · ✅ verified

```text
Using podium, call cheat_sheet and use it to author a flow that uses
scrollUntilVisible + retry + assertVisible correctly. Then run_flow it on
udid <UDID> for <BUNDLE_ID>.
```

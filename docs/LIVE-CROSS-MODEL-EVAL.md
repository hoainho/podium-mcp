# Live Cross-Model Eval — empirical model-agnosticism gate (G006 follow-up)

The decidability eval (`npm run eval:model-agnostic`) proves *architecturally* that
decision logic lives in the server. This runbook specifies the **empirical** gate:
drive the canonical flows with a STRONG and a WEAK model and require parity. It is
fully specified here so it is reproducible; it needs resources only the operator has
(a booted iOS simulator + model API budget), so it is NOT wired into the no-API CI.

## Prerequisites

- macOS + Xcode, a booted simulator (`device_list` → `device_boot`).
- A test app installed (any RN/WebView/native app exercising the three flows).
- API access for two tiers, e.g. `claude-opus-4-8` (strong) and `claude-haiku-4-5` (weak).
- An MCP client that lets each model call Podium's tools (e.g. Claude Code itself, or a
  thin harness over `@modelcontextprotocol/sdk` client + the Anthropic SDK).

## Canonical flows (the same as docs/MODEL-AGNOSTIC-AUDIT.md)

- **Flow A — Launch & assert:** device_list → device_boot → app_launch →
  inspect_screen → tap_on(<a button that appears 2×>) → assert_visible(<result>).
  Must-hit decision point: the ambiguous `tap_on` → the model MUST read the
  `ambiguous` status + candidates and re-call with `index`, NOT guess.
- **Flow B — Form fill (WebView):** tap_on(field) → input_text → assert_text.
  Must-hit: after a WebView `input_text`, the model MUST heed the `next` caveat and
  verify / switch to `mobile_type_keys` rather than report false success.
- **Flow C — Canvas dismiss:** canvas_inspect → canvas_resolve → canvas_tap("close").
  Already model-agnostic (fail-closed) — the control/parity baseline.

## Protocol

For each flow F in {A, B, C} and each model M in {opus, haiku}:
1. Reset the app to a known state.
2. Give M the SAME task prompt ("complete flow F") and Podium tools only.
3. Record: completed? (boolean), tool-call sequence, and whether M honoured each
   must-hit decision point above (chose `index` on ambiguity; verified WebView input).

## Success criteria (the gate)

- **Completion parity:** haiku completes A/B/C iff opus does (target: both 3/3).
- **Decision parity:** at every must-hit point, haiku takes the server-guided action
  (the `ambiguous`/`next` envelope is followed), with NO blind tap / false success.
- **Regression guard:** re-run the no-API `npm run eval:model-agnostic` — must stay green.

Record results in a table (flow × model → completed / decisions-honoured). A PASS here
is the empirical proof that the G003–G005 changes made Podium model-agnostic in practice.

## Why this is separated from CI

Running real models against a booted simulator costs API tokens and needs a GUI
simulator — unsuitable for a headless CI gate. The decidability eval is the CI proxy;
this runbook is the periodic empirical confirmation (run before a release that claims
model-agnosticism).

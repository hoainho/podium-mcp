# Podium Model-Agnosticism Audit (G001 baseline)

> **Goal of the initiative:** a weaker model (e.g. Haiku) must run Podium's
> testing/diagnosis flows as reliably and correctly as Opus 4.8. Achieve it by
> moving decision logic into the **server** (deterministic tools, fail-closed
> guards, explicit next-step guidance in every output) instead of relying on
> model inference.

## Method

Read all 51 tools across `src/tools/*.ts` (12 files, 5299 LOC) + the shared
result envelope `src/lib/result.ts`. Scored each tool on six **inference-burden**
dimensions — the work a weak model must do that a strong model hides:

1. **Status legibility** — does the output carry a machine-readable status, or must the model parse prose to know success/retry/ambiguous?
2. **Next-step guidance** — does the output say what to do next, or must the model infer it?
3. **Error actionability** — are errors structured + remediable, or bare strings?
4. **Target inference** — does the tool accept fuzzy/raw targets it then guesses on, or fail closed?
5. **Precondition enforcement** — is call-order (boot→launch→inspect→act) enforced/guided, or assumed?
6. **Tool-choice clarity** — does the description say when to use / NOT use this tool vs neighbours?

## Root-cause findings (codebase-wide)

### RC1 — `okResult` is shapeless free-form JSON  (`src/lib/result.ts:7`)
```ts
export function okResult(payload: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
```
Every successful result is an ad-hoc per-tool object (`{ok,text,submit,backend}`
for input_text; `{ok,visible,via}` for assert; `{ok,backend,total,ran,results}`
for run_steps). There is **no stable `status` enum and no `next` field**. A strong
model infers "succeeded, now inspect"; a weak model stalls or repeats the call.
`structuredContent` (MCP SDK's machine-readable channel) is used **nowhere**.

### RC2 — `errorResult` is a bare string  (`src/lib/result.ts:3`)
```ts
export function errorResult(message: string) {
  return { isError: true, content: [{ type: "text", text: message }] };
}
```
e.g. `"input_text failed (backend idb): flow did not pass"`. No error **code**,
no **remediation**, no **suggested follow-up tool**. A weak model cannot decide
retry vs re-inspect vs abort — the single biggest divergence source.

### RC3 — Fail-closed exists in only 2 places, not at the action layer
`canvas_resolve`/`canvas_tap` fail closed on ambiguity (`confidentEnough`,
candidate list — `src/tools/canvas.ts`) and the assert ladder fails closed on
UNVERIFIABLE (`src/tools/assert.ts`, `r.visible === null`). But the native action
tools — `tap_on` (text/id/x-y), `input_text`, `swipe` (`src/tools/screen.ts`) —
do **not** fail closed: a fuzzy text target that matches 0 or 2+ nodes still
fires a Maestro flow. Strong models pre-check with `inspect_screen`; weak models
tap blindly.

### RC4 — Preconditions are documented in prose, not enforced or signalled
`udid`+`bundleId` are required on nearly every action, but the
boot→launch→inspect→act ordering is implicit. When a precondition is unmet the
error is a generic backend string (RC2), not a `failed_precondition` with the
exact remediation tool to call.

### RC5 — Overlapping tools, only one self-describes when-to-use
`run_steps` has an excellent "When to use … use run_flow for … use individual
gesture tools for …" clause (`src/tools/steps.ts`). **No other tool does.** A
weak model must disambiguate tap_on vs run_steps vs run_flow vs engine_tap vs
canvas_tap vs webview_* from overlapping one-liners.

## Existing good patterns (the seeds to generalize)

- **Oracle ladder + tri-state verdict** (`assert.ts`): `visible: true|false|null`,
  `null` ⇒ UNVERIFIABLE error, never a false pass. Provenance via `via`.
- **Evidenced fail-closed resolve** (`canvas_resolve`): best match + all
  candidates + reasons + `confidentEnough:false` on ties. The model-agnostic gold standard — **make this the template for every action target.**
- **Batch orchestration** (`run_steps`): one call runs N gestures, returns
  per-step `results` + `failedAtIndex`. Reduces the chaining a weak model gets wrong.
- **`run_steps` "When to use"** description block — the description template.
- **Empty-result `hint`** (`canvas.ts:158`) and `targetingHint` (`screen.ts:435`) — embryonic next-step guidance; generalize into a first-class `next` field.

## Ranked worst offenders (most model-dependent first)

| # | Tool(s) | Primary burden | One-line fix direction |
|---|---|---|---|
| 1 | **ALL via `okResult`** | RC1: no status enum / no `next` | Add `{status, next[]}` to a standard envelope; emit via `structuredContent`. |
| 2 | **ALL via `errorResult`** | RC2: bare-string errors | Structured error: `{code, message, remediation, suggestedTool}`. |
| 3 | `tap_on` | RC3: taps fuzzy/ambiguous targets | Resolve-then-act; fail closed on 0/2+ matches with candidate list (port canvas_resolve). |
| 4 | `input_text` | RC3/RC2: silent WebView no-op (onChange never fires); generic failure | Detect WebView focus → `failed_precondition` + suggest mobile_type_keys. |
| 5 | `swipe` | RC3: coordinate overrides unchecked | Validate bounds; on no-effect return `needs_retry` + hint. |
| 6 | `run_flow` vs `run_steps` vs gesture tools | RC5: tool-choice ambiguity | Add "use when / NOT when" to every description (run_steps template). |
| 7 | `inspect_screen` | next-step: returns nodes, not "tappable候 + how to act" | Annotate each node with the exact follow-up call (tap_on args). |
| 8 | `engine_*` | precondition: needs instrumented build; generic throw | `failed_precondition` envelope naming the missing bridge. |
| 9 | `webview_*` | tool-choice + precondition (isInspectable) | Self-describe; `failed_precondition` when not inspectable. |
| 10 | `device_boot`/`app_launch` | precondition chain not signalled | On downstream "not booted/installed" error, suggest the exact prior tool. |

## Canonical testing flows (where weak models diverge)

**Flow A — Launch & assert (smallest real flow):**
`device_list → device_boot → app_launch → inspect_screen → tap_on → assert_visible`
- Divergence points: choosing `tap_on` target (RC3); knowing to `inspect_screen`
  before tapping (RC4/next-step); interpreting a bare tap error (RC2).

**Flow B — Form fill:** `… → tap_on(field) → input_text → assert_text`
- Divergence: WebView `input_text` silently no-ops (RC4) — weak model asserts and
  reports false success; strong model recalls the caveat from the description.

**Flow C — Canvas/game UI dismiss:** `canvas_inspect → canvas_resolve → canvas_tap`
- Already model-agnostic (fail-closed). **Proof that the pattern works** — the
  rest of the toolset should converge to it.

## Predicted divergence (baseline-by-inspection)

Without server-side guidance, a weak model is predicted to fail Flow A/B on:
(a) acting before inspecting; (b) blind taps on ambiguous text; (c) treating a
bare error as terminal or looping; (d) false-success on WebView input. Flow C is
predicted to hold across models — the design target.

## Acceptance status

- [x] Catalogued all 51 tools + scored inference burden (this doc).
- [x] Ranked worst offenders + one-line fixes.
- [x] Canonical flows + divergence hypotheses.
- [ ] **Runnable cross-model eval harness** (opus vs haiku live) — folded into G006
      (eval-gated proof); this doc is the design + predicted baseline it verifies.

## Fix sequencing (drives G002–G005)

- **G003 first** (highest leverage): standard result envelope `{status, next[]}` +
  structured error `{code, remediation, suggestedTool}` in `result.ts`. Fixes #1, #2
  across all 51 tools at one site.
- **G002**: rewrite the worst descriptions with "use when / NOT when" + preconditions (#6, #9).
- **G004**: generalize canvas_resolve fail-closed to `tap_on`/`input_text`/`swipe` (#3,#4,#5).
- **G005**: strengthen `run_steps`/`run_flow` as the one intent-level entrypoint; add per-step `next`.
- **G006**: build + run the cross-model eval; require Flow A/B/C parity across tiers.

---

## G006 result — decidability eval (reproducible, no-API proof)

`src/eval/decidability.ts` + `src/eval/decidability.test.ts` (run: `npm run eval:model-agnostic`).

**Invariant:** a tool result is *decidable* when a zero-inference agent — reading only
the machine-readable envelope, never reasoning over prose — can pick its next action:
success ⇒ `status:"ok"`; soft-fail ⇒ non-ok `status` + non-empty `next[]`; hard error ⇒
non-ok `status` + (`remediation` | `suggestedTool` | `candidates`).

**Coverage (all decidable, 10/10 tests green):**

| Flow | Decision point | Envelope | Decidable |
|---|---|---|---|
| A | tap_on, ambiguous target | `ambiguous` + candidates | ✅ |
| A | tap_on, success | `ok` + verify next | ✅ |
| B | input_text, success | `ok` + WebView-caveat next | ✅ |
| B | input_text, failure | `failed` + suggestedTool | ✅ |
| Orchestrator | run_steps, batch failure | `failed` + next (not a false `ok`) | ✅ |
| Orchestrator | run_steps, all-ok | `ok` | ✅ |

This proves the **architecture** is model-agnostic by construction: the decision logic
is the server's, not the model's, at every canonical decision point. It is the necessary
condition the project set out to guarantee.

**Honest boundary / follow-up:** this is a decidability proof, NOT a live model run. An
empirical opus-vs-haiku eval driving a booted iOS simulator end-to-end remains a future
addition — it needs a booted sim, model-invocation harness, and API budget (out of scope
for a no-API CI gate). The decidability eval is what runs in CI to prevent regressions.

## G006 addendum — zero-inference agent (empirical floor)

`src/eval/zero-inference-agent.test.ts` drives the REAL `tap_on` handler with a
brain-dead agent that reasons about NOTHING — it reads only the envelope
(`status` / `error.candidates`) and applies fixed rules. Faced with an ambiguous
match it recovers purely from the server's candidate list (picks `candidates[0].index`)
and completes Flow A in 2 steps. Because an agent with **zero inference** succeeds,
the server's guidance — not model intelligence — is what carries the flow. This is the
empirical *floor*: the weakest conceivable "model" already passes. (A live opus-vs-haiku
run, per docs/LIVE-CROSS-MODEL-EVAL.md, sits above this floor and needs sim + API.)

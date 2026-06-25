/**
 * v0.4.0 "Canvas Brain" — shared contract for no-vision canvas/WebGL analysis.
 *
 * Every canvas track (framework adapters, semantic resolver, a11y, vision
 * fallback) produces or consumes these types so the modules compose without
 * drift. The golden rule: a `CanvasObject` carries TAP-READY coordinates in
 * **CSS pixels relative to the canvas element's top-left** (the unit
 * Playwright/`tap_on` expect) — adapters own the backing-store→CSS / DPR
 * conversion so downstream code never re-derives it.
 *
 * No-vision first: `source: "scene-graph"` and `"a11y"` are free/cheap; only
 * `"vision"` spends image tokens and is opt-in + token-accounted.
 */
/** Minimum score for a resolver pick to be actioned without confirmation. */
export const CANVAS_CONFIDENCE_THRESHOLD = 0.6;
/** Minimum score gap between best and runner-up to count as unambiguous. */
export const CANVAS_AMBIGUITY_MARGIN = 0.15;

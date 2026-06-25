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

/** Where a CanvasObject's geometry came from (drives the no-vision-first ladder). */
export type CanvasFramework =
  | "konva"
  | "fabric"
  | "pixi"
  | "phaser"
  | "three"
  | "babylon"
  | "a11y"
  | "vision"
  | "unknown";

/** Selector kinds, mirroring the engine `By` set so canvas feels like DOM/native. */
export type CanvasSelectorKind = "name" | "id" | "text" | "type" | "role" | "path";

/** CSS-pixel rectangle relative to the canvas element top-left. */
export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A canvas UI node addressable like a DOM/native element. `x`/`y` are the
 * tap-ready CENTER in CSS pixels relative to the canvas element top-left.
 */
export interface CanvasObject {
  name: string;
  id?: string | number;
  /** Framework class, e.g. "Konva.Rect", "PIXI.Sprite", "Mesh", "Button". */
  type?: string;
  /** Visible text label, when the node exposes one. */
  text?: string;
  /** Inferred semantic role, e.g. "button" | "close" | "input" | "icon". */
  role?: string;
  x: number;
  y: number;
  bbox?: CanvasRect;
  visible?: boolean;
  interactable?: boolean;
  framework?: CanvasFramework;
  /** Cheap (no-vision) vs paid (vision) provenance. */
  source?: "scene-graph" | "a11y" | "vision";
}

/** Result of inspecting a canvas surface for objects matching a selector. */
export interface CanvasInspectResult {
  framework: CanvasFramework;
  count: number;
  objects: CanvasObject[];
}

/** One scored candidate from the semantic resolver, with falsifiable evidence. */
export interface ResolveCandidate {
  object: CanvasObject;
  /** 0..1 confidence. */
  score: number;
  /** Human-readable evidence for the score (e.g. ["text=close", "top-right corner"]). */
  reasons: string[];
}

/**
 * Result of resolving a fuzzy intent (e.g. "close") to a tappable target.
 * Fail-closed: `confidentEnough` is true only when `best` clears the threshold
 * AND is unambiguous vs the runner-up — otherwise the caller must not blind-tap.
 */
export interface ResolveResult {
  intent: string;
  best: ResolveCandidate | null;
  candidates: ResolveCandidate[];
  confidentEnough: boolean;
}

/** Minimum score for a resolver pick to be actioned without confirmation. */
export const CANVAS_CONFIDENCE_THRESHOLD = 0.6;

/** Minimum score gap between best and runner-up to count as unambiguous. */
export const CANVAS_AMBIGUITY_MARGIN = 0.15;

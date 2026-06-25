/**
 * v0.4.0 "Canvas Brain" — the "close brain": semantic intent resolver.
 *
 * Given a fuzzy human intent ("close", "dismiss", "x", "✕"…) and the objects a
 * canvas adapter reported, rank the objects by how well each one satisfies the
 * intent and decide — FAIL-CLOSED — whether the top pick is safe to blind-tap.
 *
 * Design notes:
 *  - Pure & deterministic: no I/O, no clock, no randomness, never throws. The
 *    same inputs always produce the same `ResolveResult`, so callers (and tests)
 *    can reason about it like a lookup.
 *  - Evidence first: every scored candidate carries `reasons[]` (e.g.
 *    ["text=close", "role=button", "top-right corner"]) so a low-confidence
 *    miss is explainable rather than a mystery.
 *  - Fail-closed: two equally-good targets must NOT be confidently actioned —
 *    `confidentEnough` requires both an absolute threshold AND a margin over the
 *    runner-up (see canvas-types constants). When unsure, we'd rather ask.
 *
 * All shared types and the two confidence constants come from canvas-types.ts —
 * this module never redefines the contract.
 */
import {
  CANVAS_CONFIDENCE_THRESHOLD,
  CANVAS_AMBIGUITY_MARGIN,
} from "./canvas-types.js";
import type {
  CanvasObject,
  CanvasRect,
  ResolveCandidate,
  ResolveResult,
} from "./canvas-types.js";

/**
 * Intent → equivalent surface forms. Keys are canonical intents; values include
 * the key itself plus synonyms and icon glyphs that mean the same thing. Used by
 * the scorer to match an object's text/name/role against the *meaning* of an
 * intent rather than its literal spelling (so "✕" resolves "close").
 *
 * Lower-cased at match time; entries here are kept human-readable.
 */
export const INTENT_SYNONYMS: Record<string, string[]> = {
  close: ["close", "dismiss", "x", "✕", "×", "✖", "⨯", "cancel", "exit", "back"],
  ok: ["ok", "okay", "confirm", "accept", "yes", "done", "apply"],
  confirm: ["confirm", "ok", "accept", "yes", "submit", "apply"],
  continue: ["continue", "next", "proceed", "resume", "go", "→", "▶"],
  play: ["play", "start", "▶", "►", "go", "resume"],
  settings: ["settings", "options", "preferences", "config", "gear", "⚙", "⚙️"],
  menu: ["menu", "more", "hamburger", "options", "☰", "≡", "⋮", "⋯"],
  next: ["next", "continue", "forward", "→", "▶", "►", ">"],
  back: ["back", "previous", "prev", "return", "←", "◀", "◁", "<"],
};

/** Intents whose target conventionally lives in the TOP-RIGHT corner. */
const CORNER_INTENTS = new Set(["close", "dismiss", "exit", "cancel"]);

/** Roles that imply a tappable control (used by the role-match component). */
const INTERACTABLE_ROLES = new Set([
  "button",
  "close",
  "link",
  "tab",
  "menuitem",
  "checkbox",
  "switch",
  "input",
]);

/** Per-component weights. Tuned so a clean exact-text hit clears the threshold
 *  on its own, while weak signals (type hint, position) only nudge. */
const W = {
  exactText: 0.6,
  exactName: 0.5,
  // A whole-string synonym/icon hit (text IS "dismiss" or "✕") is nearly as
  // decisive as matching the literal intent word, so it must clear threshold on
  // its own once the interactable boost is added.
  synonymText: 0.55,
  synonymName: 0.5,
  substringText: 0.3,
  substringName: 0.22,
  roleExact: 0.3,
  roleSynonym: 0.22,
  typeHint: 0.12,
  interactable: 0.1,
  position: 0.18,
} as const;

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function norm(s: string | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** Synonym set for an intent, lower-cased. Falls back to the bare intent word
 *  so unknown intents still match on their own text/name. */
function synonymsFor(intent: string): string[] {
  const key = norm(intent);
  const list = INTENT_SYNONYMS[key];
  if (list && list.length > 0) return list.map((s) => s.toLowerCase());
  return key ? [key] : [];
}

/**
 * Derive a surface rectangle from the objects themselves when the caller did
 * not supply one: the bounding box of every object's bbox (preferred) or its
 * tap center. Returns null when nothing positional is available.
 */
function inferSurface(objects: CanvasObject[]): CanvasRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let seen = false;

  for (const o of objects) {
    const candidates: Array<[number, number]> = [];
    if (o.bbox) {
      candidates.push([o.bbox.x, o.bbox.y]);
      candidates.push([o.bbox.x + o.bbox.width, o.bbox.y + o.bbox.height]);
    }
    if (Number.isFinite(o.x) && Number.isFinite(o.y)) {
      candidates.push([o.x, o.y]);
    }
    for (const [px, py] of candidates) {
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
      seen = true;
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }

  if (!seen) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Tap center of an object, preferring an explicit center, else the bbox center. */
function centerOf(obj: CanvasObject): { cx: number; cy: number } | null {
  if (Number.isFinite(obj.x) && Number.isFinite(obj.y)) {
    return { cx: obj.x, cy: obj.y };
  }
  if (obj.bbox) {
    return { cx: obj.bbox.x + obj.bbox.width / 2, cy: obj.bbox.y + obj.bbox.height / 2 };
  }
  return null;
}

/**
 * Top-right "corner-ness" of an object within the surface, in [0,1]. 1 means the
 * object sits exactly at the surface's top-right; 0 means bottom-left. A degenerate
 * surface (zero width/height) yields a neutral 0 so it neither helps nor hurts.
 */
function topRightScore(obj: CanvasObject, surface: CanvasRect): number {
  const c = centerOf(obj);
  if (!c) return 0;
  const w = surface.width;
  const h = surface.height;
  if (!(w > 0) || !(h > 0)) return 0;
  // Fraction toward the right edge and the top edge, each clamped to [0,1].
  const rightness = clamp01((c.cx - surface.x) / w);
  const topness = clamp01(1 - (c.cy - surface.y) / h);
  return clamp01((rightness + topness) / 2);
}

/**
 * Score a single object against an intent. Returns the 0..1 score and the
 * falsifiable evidence behind it. Exported so tests can probe one object in
 * isolation. `surface` (when known) enables the top-right position heuristic
 * for close-like intents.
 */
export function scoreObject(
  obj: CanvasObject,
  intent: string,
  surface?: CanvasRect
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const want = norm(intent);
  if (!want) return { score: 0, reasons };

  const syns = synonymsFor(intent);
  const synSet = new Set(syns);
  const text = norm(obj.text);
  const name = norm(obj.name);
  const role = norm(obj.role);
  const type = norm(obj.type);

  // Combine signals with probabilistic OR: each weight w nudges the score by
  // w*(1-score). This is monotonic and bounded in [0,1) WITHOUT a hard clamp, so
  // weak corroboration (interactable, position) always moves the result up a
  // little instead of being silently erased once strong signals near 1.0.
  let score = 0;
  const add = (w: number): void => {
    score = score + w * (1 - score);
  };

  // --- Text match (strongest signal) ---
  if (text) {
    if (text === want) {
      add(W.exactText);
      reasons.push(`text=${text}`);
    } else if (synSet.has(text)) {
      add(W.synonymText);
      reasons.push(`text~${text}`);
    } else if (syns.some((s) => text.includes(s))) {
      add(W.substringText);
      reasons.push(`text contains "${want}"`);
    }
  }

  // --- Name match ---
  if (name) {
    if (name === want) {
      add(W.exactName);
      reasons.push(`name=${name}`);
    } else if (synSet.has(name)) {
      add(W.synonymName);
      reasons.push(`name~${name}`);
    } else if (syns.some((s) => name.includes(s))) {
      add(W.substringName);
      reasons.push(`name contains "${want}"`);
    }
  }

  // --- Role match ---
  if (role) {
    if (role === want || synSet.has(role)) {
      add(W.roleExact);
      reasons.push(`role=${role}`);
    } else if (syns.some((s) => role.includes(s))) {
      add(W.roleSynonym);
      reasons.push(`role~${role}`);
    }
  }

  // --- Type hint (e.g. "Button" class) — weak corroboration only ---
  if (type && syns.some((s) => type.includes(s))) {
    add(W.typeHint);
    reasons.push(`type~${type}`);
  }

  // --- Interactable boost (only meaningful once something else matched) ---
  if (score > 0) {
    const interactable =
      obj.interactable === true || (obj.role ? INTERACTABLE_ROLES.has(role) : false);
    if (interactable) {
      add(W.interactable);
      reasons.push("interactable");
    }
  }

  // --- Position heuristic: top-right corner for close-like intents ---
  // Applied as a DIRECT additive prior (not through the prob-OR combiner above)
  // so it stays a meaningful tie-breaker between otherwise-similar candidates:
  // a clear top-right vs bottom-left split is worth ~W.position, enough to clear
  // the ambiguity margin, whereas a near-equal split barely moves either score.
  if (CORNER_INTENTS.has(want) && surface) {
    const tr = topRightScore(obj, surface);
    if (tr > 0) {
      score += W.position * tr;
      if (tr >= 0.6) reasons.push("top-right corner");
    }
  }

  return { score: clamp01(score), reasons };
}

/**
 * Resolve a fuzzy `intent` to a ranked, evidenced target over `objects`.
 *
 * Returns the best candidate, all scored candidates sorted by score (desc), and
 * a fail-closed `confidentEnough` flag: true only when the best clears
 * CANVAS_CONFIDENCE_THRESHOLD **and** beats the runner-up by at least
 * CANVAS_AMBIGUITY_MARGIN (so two equally-good targets are never blind-tapped).
 *
 * Empty input (no objects or blank intent) yields a confidently-empty result.
 */
export function resolveIntent(
  objects: CanvasObject[],
  intent: string,
  opts?: { surface?: CanvasRect }
): ResolveResult {
  const trimmed = intent.trim();
  if (objects.length === 0 || trimmed === "") {
    return { intent: trimmed, best: null, candidates: [], confidentEnough: false };
  }

  const surface = opts?.surface ?? inferSurface(objects) ?? undefined;

  const scored: ResolveCandidate[] = objects.map((object) => {
    const { score, reasons } = scoreObject(object, trimmed, surface);
    return { object, score, reasons };
  });

  // Keep only objects with any positive evidence as actionable candidates, then
  // sort by score desc. Ties are stable (original order) to stay deterministic.
  const candidates = scored
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = candidates[0] ?? null;
  const runnerUp = candidates[1] ?? null;

  const confidentEnough =
    best !== null &&
    best.score >= CANVAS_CONFIDENCE_THRESHOLD &&
    best.score - (runnerUp?.score ?? 0) >= CANVAS_AMBIGUITY_MARGIN;

  return { intent: trimmed, best, candidates, confidentEnough };
}

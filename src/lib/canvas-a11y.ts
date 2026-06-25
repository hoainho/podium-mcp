/**
 * canvas-a11y.ts — opportunistic (free) accessibility layer for Canvas Brain.
 *
 * Normalises Flutter `flt-semantics` nodes and ARIA-annotated DOM elements into
 * CanvasObject[], providing tap-ready centre coordinates without spending any
 * image tokens. This is the second rung of the no-vision-first ladder after
 * scene-graph adapters.
 */

import type { CanvasObject, CanvasRect } from "./canvas-types.js";

// ---------------------------------------------------------------------------
// Internal shapes for the raw DOM/semantics snapshot
// ---------------------------------------------------------------------------

interface RawA11yNode {
  role?: unknown;
  /** aria-label value or semantics label */
  label?: unknown;
  text?: unknown;
  rect?: unknown;
}

interface ParsedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseRect(rect: unknown): ParsedRect | null {
  if (rect == null || typeof rect !== "object") return null;
  const r = rect as Record<string, unknown>;
  const x = Number(r["x"]);
  const y = Number(r["y"]);
  const width = Number(r["width"]);
  const height = Number(r["height"]);
  if (!isFinite(x) || !isFinite(y) || !isFinite(width) || !isFinite(height)) {
    return null;
  }
  return { x, y, width, height };
}

function nodeToCanvasObject(node: RawA11yNode): CanvasObject | null {
  const rect = parseRect(node.rect);
  if (rect === null) return null;

  const bbox: CanvasRect = rect;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;

  const role = typeof node.role === "string" && node.role.length > 0 ? node.role : undefined;
  const text =
    typeof node.label === "string" && node.label.length > 0
      ? node.label
      : typeof node.text === "string" && node.text.length > 0
        ? node.text
        : undefined;

  const name = text ?? role ?? "a11y-node";

  return {
    name,
    x: cx,
    y: cy,
    bbox,
    source: "a11y",
    framework: "a11y",
    role,
    text,
    visible: true,
    interactable: true,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalise an accessibility/DOM snapshot into CanvasObject[].
 *
 * Accepts either a parsed JSON array of raw nodes or a JSON string that
 * decodes to one. Each node may be a Flutter `flt-semantics` element or any
 * ARIA-annotated element carrying: role, label/aria-label, text, and a rect
 * {x, y, width, height} in CSS pixels relative to the canvas top-left.
 *
 * Nodes without a fully finite rect are silently dropped.
 * Never throws — returns [] on any bad input.
 */
export function parseA11yTree(domJson: unknown): CanvasObject[] {
  try {
    let raw: unknown = domJson;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        return [];
      }
    }
    if (!Array.isArray(raw)) return [];

    const objects: CanvasObject[] = [];
    for (const node of raw) {
      if (node == null || typeof node !== "object") continue;
      const obj = nodeToCanvasObject(node as RawA11yNode);
      if (obj !== null) objects.push(obj);
    }
    return objects;
  } catch {
    return [];
  }
}

/**
 * Returns a self-contained JS snippet (safe to evaluate in-page) that scrapes
 * Flutter `flt-semantics` nodes and ARIA-annotated elements, collecting each
 * element's role, aria-label, inner text, and getBoundingClientRect into a
 * JSON-serialisable array.
 *
 * The result can be passed to `webview_eval` / `evaluate_script` and the
 * returned value fed directly into `parseA11yTree`.
 *
 * Never throws in the target page.
 */
export function buildA11ySnapshotScript(): string {
  // The returned string is indented for readability but is a fully
  // self-contained IIFE — no external deps.
  return `(function collectA11y() {
  try {
    var seen = new Set();
    var results = [];
    var selectors = ['flt-semantics', '[role]', '[aria-label]'];
    for (var si = 0; si < selectors.length; si++) {
      var nodes = document.querySelectorAll(selectors[si]);
      for (var ni = 0; ni < nodes.length; ni++) {
        var el = nodes[ni];
        if (seen.has(el)) continue;
        seen.add(el);
        var r = el.getBoundingClientRect();
        if (!r || (r.width === 0 && r.height === 0)) continue;
        results.push({
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          label: el.getAttribute('aria-label') || '',
          text: (el.textContent || '').trim().slice(0, 200),
          rect: { x: r.left, y: r.top, width: r.width, height: r.height }
        });
      }
    }
    return JSON.stringify(results);
  } catch (e) {
    return '[]';
  }
})()`;
}

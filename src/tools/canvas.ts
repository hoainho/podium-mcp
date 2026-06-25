/**
 * Canvas Brain tools (v0.4.0) — DOM-like, NO-VISION addressing of canvas/WebGL
 * UIs hosted in an inspectable WKWebView.
 *
 * A `<canvas>` is opaque to the DOM, but most JS canvas/WebGL apps keep a live
 * scene graph (Pixi/Konva/Fabric/Phaser/Three/Babylon). These tools inject the
 * `canvas-adapters` bridge into the page (one eval), read that scene graph as
 * tap-ready `CanvasObject[]`, and — for `canvas_tap` — resolve a fuzzy intent
 * ("close") to a single target and tap it at absolute screen coordinates.
 *
 *   canvas_inspect  — list canvas objects (optionally filtered by selector)
 *   canvas_resolve  — rank objects against an intent (evidenced, fail-closed)
 *   canvas_tap      — resolve + tap the confident match (else fail closed)
 *
 * No screenshots, no vision — the token-efficient path. Coordinates are mapped
 * the same way webview_inspect maps DOM elements: the bridge reports CSS px
 * relative to the canvas element, we add the canvas element's viewport offset
 * and the WebView's on-screen bounds to get an absolute logical-point tap.
 *
 * Requires the app's WKWebView to be inspectable (debug/staging) AND the canvas
 * framework's root reachable (most expose it on window, or Pixi's
 * `__PIXI_APP__`). When neither a WebView nor a known framework is present, the
 * tools fail closed with an actionable error — never a vision fallback. Vision
 * is a separate, opt-in path (PODIUM_ALLOW_VISION) and is not wired here.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, okResult } from "../lib/result.js";
import { resolveWebview, evalWebview } from "../lib/webview.js";
import { buildCanvasBridgeScript, parseCanvasObjects } from "../lib/canvas-adapters.js";
import { resolveIntent } from "../lib/canvas-resolver.js";
import { nativeTap } from "../lib/gesture.js";
import type { CanvasObject, CanvasSelectorKind } from "../lib/canvas-types.js";

const SELECTOR = z.enum(["name", "id", "text", "type", "role", "path"]);

const CANVAS_NOTE =
  " Requires an inspectable WKWebView (isInspectable=true; debug/staging) hosting a " +
  "canvas/WebGL framework (Pixi/Konva/Fabric/Phaser/Three/Babylon) with its root reachable " +
  "(commonly on window, or Pixi's __PIXI_APP__). NO screenshots/vision — fails closed otherwise.";

const EVAL_DISABLED =
  "canvas tools inject a JS bridge via eval, which is disabled " +
  "(PODIUM_DISABLE_WEBVIEW_EVAL=1). Unset it to allow canvas inspection in inspectable WebViews.";

interface CanvasSurface {
  webviewId: string;
  url: string;
  framework: string;
  objects: CanvasObject[];
  /** WebView on-screen origin + canvas element viewport offset (logical points). */
  originX: number;
  originY: number;
}

type SurfaceResult = { ok: true; data: CanvasSurface } | { ok: false; error: string };

/**
 * Inject the bridge, run one inspect, and read back the canvas element's
 * viewport offset — all in a single eval round-trip. `selector` filters
 * in-page when provided (canvas_inspect); omit it to get every object
 * (canvas_resolve / canvas_tap, which rank client-side).
 */
async function inspectCanvasSurface(
  udid: string,
  webviewId: string | undefined,
  selector?: { kind: CanvasSelectorKind; value: string }
): Promise<SurfaceResult> {
  const wv = await resolveWebview(udid, webviewId);
  if (!wv.ok) return wv;

  const args = selector ? `${JSON.stringify(selector.kind)},${JSON.stringify(selector.value)}` : "";
  // bridge install + inspect + largest-canvas viewport offset, serialized once.
  const expr =
    buildCanvasBridgeScript() +
    ";(function(){var r=window.__podiumCanvas.inspect(" +
    args +
    ");var cs=document.getElementsByTagName('canvas'),b=null,ba=-1;" +
    "for(var i=0;i<cs.length;i++){var a=cs[i].width*cs[i].height;if(a>ba){ba=a;b=cs[i];}}" +
    "var o=b?b.getBoundingClientRect():{left:0,top:0};" +
    "return JSON.stringify({framework:r.framework,objects:r.objects,canvasLeft:o.left,canvasTop:o.top});})()";

  const ev = await evalWebview(udid, wv.data.id, expr);
  if (!ev.ok) return ev;

  let parsed: { framework?: unknown; objects?: unknown; canvasLeft?: unknown; canvasTop?: unknown };
  try {
    parsed = JSON.parse(ev.data) as typeof parsed;
  } catch {
    return { ok: false, error: `canvas bridge returned non-JSON: ${ev.data.slice(0, 200)}` };
  }

  const objects = parseCanvasObjects(parsed.objects);
  const framework = typeof parsed.framework === "string" ? parsed.framework : "unknown";
  const canvasLeft = Number(parsed.canvasLeft);
  const canvasTop = Number(parsed.canvasTop);
  const bx = wv.data.bounds?.x ?? 0;
  const by = wv.data.bounds?.y ?? 0;

  return {
    ok: true,
    data: {
      webviewId: wv.data.id,
      url: wv.data.url,
      framework,
      objects,
      originX: bx + (Number.isFinite(canvasLeft) ? canvasLeft : 0),
      originY: by + (Number.isFinite(canvasTop) ? canvasTop : 0),
    },
  };
}

/** Shared "no objects" hint so a bare-canvas page gives an actionable message. */
function emptyHint(framework: string): string {
  return framework === "unknown"
    ? "no canvas framework detected on the page (looked for Pixi/Konva/Fabric/Phaser/Three/Babylon). " +
        "Expose the framework root on window (e.g. window.app / window.stage / window.scene), or use a " +
        "screenshot + tap_with_fallback for a fully opaque canvas."
    : `the ${framework} scene graph reported no addressable objects.`;
}

export function registerCanvasTools(server: McpServer): void {
  // ─── canvas_inspect ──────────────────────────────────────────────────────────
  server.tool(
    "canvas_inspect",
    "Lists canvas/WebGL objects (Pixi/Konva/Fabric/Phaser/Three/Babylon) as DOM-like elements with " +
      "tap-ready coordinates — NO screenshot/vision. Optionally filter by selector (name/id/text/type/role)." +
      CANVAS_NOTE,
    {
      udid: z.string().describe("Simulator / device UDID (from device_list)"),
      by: SELECTOR.optional().describe("Selector kind to filter by (omit to list all)"),
      value: z.string().optional().describe("Selector value (required when 'by' is given)"),
      webviewId: z.string().optional().describe("Target WebView id. Omit to auto-select the first visible one."),
    },
    async ({ udid, by, value, webviewId }) => {
      if (process.env.PODIUM_DISABLE_WEBVIEW_EVAL === "1") return errorResult(EVAL_DISABLED);
      if (by && typeof value !== "string") return errorResult("canvas_inspect: 'value' is required when 'by' is set.");
      const surface = await inspectCanvasSurface(
        udid,
        webviewId,
        by ? { kind: by, value: value as string } : undefined
      );
      if (!surface.ok) return errorResult(surface.error);
      return okResult({
        webviewId: surface.data.webviewId,
        url: surface.data.url,
        framework: surface.data.framework,
        count: surface.data.objects.length,
        objects: surface.data.objects,
        ...(surface.data.objects.length === 0 ? { hint: emptyHint(surface.data.framework) } : {}),
      });
    }
  );

  // ─── canvas_resolve ──────────────────────────────────────────────────────────
  server.tool(
    "canvas_resolve",
    "Resolves a fuzzy intent (e.g. \"close\", \"settings\", \"✕\") to a ranked, EVIDENCED canvas target " +
      "without tapping — the 'close brain'. Returns the best match, all candidates with reasons, and a " +
      "fail-closed confidentEnough flag (false when two targets tie). NO vision." +
      CANVAS_NOTE,
    {
      udid: z.string().describe("Simulator / device UDID"),
      intent: z.string().describe('What you want to act on, e.g. "close", "play", "settings"'),
      webviewId: z.string().optional().describe("Target WebView id. Omit to auto-select."),
    },
    async ({ udid, intent, webviewId }) => {
      if (process.env.PODIUM_DISABLE_WEBVIEW_EVAL === "1") return errorResult(EVAL_DISABLED);
      const surface = await inspectCanvasSurface(udid, webviewId);
      if (!surface.ok) return errorResult(surface.error);
      const resolved = resolveIntent(surface.data.objects, intent);
      return okResult({
        webviewId: surface.data.webviewId,
        framework: surface.data.framework,
        intent: resolved.intent,
        confidentEnough: resolved.confidentEnough,
        best: resolved.best,
        candidates: resolved.candidates.slice(0, 8),
        ...(surface.data.objects.length === 0 ? { hint: emptyHint(surface.data.framework) } : {}),
      });
    }
  );

  // ─── canvas_tap ──────────────────────────────────────────────────────────────
  server.tool(
    "canvas_tap",
    "Resolves an intent to a single canvas target and TAPS it at absolute screen coordinates — the native-like " +
      "'close this' for canvas UIs. Fail-closed: if no confident, unambiguous match exists it does NOT tap and " +
      "returns the candidates so you can disambiguate. NO vision." +
      CANVAS_NOTE,
    {
      udid: z.string().describe("Simulator / device UDID"),
      intent: z.string().describe('What to tap, e.g. "close", "play", or an exact object name'),
      bundleId: z.string().optional().describe("App bundle id (only used for the Maestro tap fallback)"),
      webviewId: z.string().optional().describe("Target WebView id. Omit to auto-select."),
    },
    async ({ udid, intent, bundleId, webviewId }) => {
      if (process.env.PODIUM_DISABLE_WEBVIEW_EVAL === "1") return errorResult(EVAL_DISABLED);
      const surface = await inspectCanvasSurface(udid, webviewId);
      if (!surface.ok) return errorResult(surface.error);
      if (surface.data.objects.length === 0) return errorResult(emptyHint(surface.data.framework));

      const resolved = resolveIntent(surface.data.objects, intent);
      if (!resolved.confidentEnough || !resolved.best) {
        return errorResult(
          `canvas_tap: no confident, unambiguous match for "${intent}" — not tapping (fail-closed). ` +
            `Top candidates: ${JSON.stringify(
              resolved.candidates.slice(0, 5).map((c) => ({ name: c.object.name, text: c.object.text, score: Number(c.score.toFixed(2)), reasons: c.reasons }))
            )}`
        );
      }

      const target = resolved.best.object;
      const screenX = Math.round(surface.data.originX + target.x);
      const screenY = Math.round(surface.data.originY + target.y);
      const tap = await nativeTap(udid, screenX, screenY, bundleId ? { bundleId } : undefined);
      if (!tap.ok) return errorResult(`canvas_tap resolved "${intent}" → (${screenX},${screenY}) but the tap failed: ${tap.detail}`);
      return okResult({
        ok: true,
        intent: resolved.intent,
        framework: surface.data.framework,
        tapped: { name: target.name, text: target.text, type: target.type, score: Number(resolved.best.score.toFixed(2)), reasons: resolved.best.reasons },
        screenX,
        screenY,
        backend: tap.backend,
      });
    }
  );
}

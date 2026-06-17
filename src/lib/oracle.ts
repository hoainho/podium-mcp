/**
 * Verification oracle (observe layer) — separate from gesture.ts (act layer).
 *
 * Source-of-truth precedence for "is X visible?":
 *   1. WebView DOM   (authoritative for web-rendered content)
 *   2. native a11y   (findElements over the accessibility tree)
 *   3. Maestro       (one-shot assertVisible; slow JVM fallback)
 * Screenshots are NEVER an oracle.
 *
 * Critically, when the foreground is a WebView and the DOM channel is
 * unavailable (e.g. isInspectable=false in a prod build), we return a distinct
 * `unverifiable` verdict rather than reading the (empty) native a11y tree —
 * that empty tree would make "not visible" assertions falsely pass. Fail closed.
 */
import { getBackend, findElements } from "./native.js";
import type { NativeBackend } from "./native.js";
import { resolveForegroundApp } from "./gesture.js";
import { runMaestroFlow } from "./maestro.js";
import { listWebviews, evalWebview } from "./webview.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll the native element tree (or a one-shot Maestro assert) until `text` is
 * visible. Promoted verbatim from steps.ts so run_steps and the standalone
 * assert_* tools share one implementation (mirrors the R5 gesture refactor).
 */
export async function pollVisible(
  udid: string,
  be: NativeBackend | null,
  text: string,
  timeoutMs: number,
  bundleId?: string
): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (be) {
      const els = await be.describeAll(udid);
      if (els && findElements(els, { text }).length > 0) return true;
    } else {
      const appId = bundleId ?? (await resolveForegroundApp(udid));
      if (appId) {
        const yaml = `appId: ${appId}\n---\n- assertVisible: ${JSON.stringify(text)}`;
        const m = await runMaestroFlow({ udid, yaml, timeoutMs: 5_000 }).catch(() => null);
        if (m?.passed) return true;
      }
    }
    if (Date.now() - start >= timeoutMs) return false;
    await sleep(400);
  }
}

export interface Surface {
  surface: "native" | "webview";
  webviewId?: string;
}

/**
 * Advice for a coordinate-based tap, distinguishing the two fragility causes so
 * the engineer knows the right fix (testID on a native element vs a DOM selector
 * for WebView content) rather than shipping a brittle coordinate.
 */
export function targetingHint(surface: "native" | "webview"): string {
  return surface === "webview"
    ? "coordinate tap on WebView content — brittle across layouts. Use webview_inspect to resolve a CSS selector to exact tap coordinates instead."
    : "coordinate tap on native content — brittle. Prefer tap_on by text/accessibilityId; if the element has no testID, add one for stable targeting.";
}

/**
 * Classify the foreground as native vs WebView. A WebView is reported only when
 * an *inspectable* WebView is present (listWebviews succeeds with ≥1 entry);
 * otherwise (no backend, prod isInspectable=false, no WebView) → native.
 */
export async function detectSurface(udid: string): Promise<Surface> {
  const list = await listWebviews(udid);
  if (list.ok && list.data.length > 0) {
    const visible = list.data.find((w) => w.isVisible) ?? list.data[0];
    return { surface: "webview", webviewId: visible.id };
  }
  return { surface: "native" };
}

export type VisibleVia = "webview-dom" | "native-a11y" | "maestro" | "unverifiable";
export interface VisibleResult {
  /** true = present, false = absent (confirmed by a capable oracle), null = could not verify. */
  visible: boolean | null;
  via: VisibleVia;
}

/** Query a WebView's DOM for a selector or text. true/false, or null on eval failure. */
async function domVisible(
  udid: string,
  webviewId: string,
  sel: { text?: string; selector?: string }
): Promise<boolean | null> {
  const expr = sel.selector
    ? `!!document.querySelector(${JSON.stringify(sel.selector)})`
    : `(function(){var t=document.body&&document.body.innerText;return !!t&&t.indexOf(${JSON.stringify(sel.text ?? "")})>=0;})()`;
  const r = await evalWebview(udid, webviewId, expr);
  if (!r.ok) return null;
  return /\btrue\b/i.test(r.data);
}

/**
 * Resolve "is sel visible?" using the precedence ladder, polling up to timeoutMs.
 * - WebView surface → DOM only; DOM-eval failure → {visible:null, via:'unverifiable'} (fail closed).
 * - native surface  → a11y (text) then Maestro fallback.
 * Returns visible:false only when a *capable* oracle confirms absence.
 */
export async function checkVisible(
  udid: string,
  sel: { text?: string; selector?: string },
  opts: { timeoutMs?: number; bundleId?: string; contains?: boolean } = {}
): Promise<VisibleResult> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  const start = Date.now();
  const surface = await detectSurface(udid);

  for (;;) {
    if (surface.surface === "webview" && surface.webviewId) {
      const dom = await domVisible(udid, surface.webviewId, sel);
      if (dom === null) return { visible: null, via: "unverifiable" }; // can't read DOM → don't guess
      if (dom === true) return { visible: true, via: "webview-dom" };
      if (Date.now() - start >= timeoutMs) return { visible: false, via: "webview-dom" };
    } else {
      // native surface — a11y/Maestro work on text (not raw CSS selectors)
      if (sel.text) {
        const be = await getBackend();
        if (be) {
          const els = await be.describeAll(udid);
          if (els) {
            const needle = sel.text.toLowerCase();
            const hit = opts.contains
              ? els.some((e) => (e.label ?? "").toLowerCase().includes(needle) || (e.value ?? "").toLowerCase().includes(needle))
              : findElements(els, { text: sel.text }).length > 0;
            if (hit) return { visible: true, via: "native-a11y" };
          }
        } else {
          const appId = opts.bundleId ?? (await resolveForegroundApp(udid));
          if (appId) {
            const m = await runMaestroFlow({
              udid,
              yaml: `appId: ${appId}\n---\n- assertVisible: ${JSON.stringify(sel.text)}`,
              timeoutMs: 5_000,
            }).catch(() => null);
            if (m?.passed) return { visible: true, via: "maestro" };
          }
        }
        if (Date.now() - start >= timeoutMs) return { visible: false, via: "native-a11y" };
      } else {
        // selector-only on a native surface — no DOM to query → can't verify
        return { visible: null, via: "unverifiable" };
      }
    }
    await sleep(300);
  }
}

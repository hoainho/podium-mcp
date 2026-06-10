/**
 * WebView (WKWebView) introspection via mobilecli's CDP-backed `webview` suite.
 *
 * This is the fix for podium's long-standing "WebView content is opaque"
 * limitation: every coordinate-based tool previously required eyeballing a
 * screenshot. With a live DOM we can resolve a CSS selector to exact on-screen
 * tap coordinates, read page state via JS, and drive navigation.
 *
 * WebView tools are mobilecli-only — idb and Maestro have no equivalent — and
 * require the app's WKWebView to be inspectable (debug/staging builds; prod
 * App Store builds frequently set isInspectable=false).
 */
import { run } from "./exec.js";
import { resolveMobilecli } from "./native.js";
const NO_BACKEND = "webview tools require the bundled mobilecli backend, which did not resolve. " +
    "Run `npm install` inside podium-mcp (mobilecli is a dependency) or set PODIUM_MOBILECLI.";
/** Parse mobilecli's `{ status, data }` envelope. */
function parseEnvelope(stdout) {
    try {
        const p = JSON.parse(stdout);
        return (p.data ?? null);
    }
    catch {
        return null;
    }
}
/** List embedded WebViews on a booted device. Never throws. */
export async function listWebviews(udid) {
    const bin = await resolveMobilecli();
    if (!bin)
        return { ok: false, error: NO_BACKEND };
    const r = await run(bin, ["webview", "list", "--device", udid], { timeout: 20_000 });
    if (r.code !== 0)
        return { ok: false, error: r.stderr || r.stdout };
    const data = parseEnvelope(r.stdout);
    if (!Array.isArray(data)) {
        return { ok: false, error: `unparseable webview list: ${r.stdout.slice(0, 300)}` };
    }
    return { ok: true, data };
}
/**
 * Resolve the target WebView: explicit id when given, else the first visible
 * WebView, else the first one. Returns the chosen Webview or an error.
 */
export async function resolveWebview(udid, webviewId) {
    const list = await listWebviews(udid);
    if (!list.ok)
        return list;
    if (list.data.length === 0) {
        return {
            ok: false,
            error: "no embedded WebViews found. The app may not host a WKWebView, or the " +
                "WebView is not inspectable (production builds often set isInspectable=false).",
        };
    }
    if (webviewId) {
        const found = list.data.find((w) => w.id === webviewId);
        if (!found) {
            return { ok: false, error: `webview id ${webviewId} not found in ${JSON.stringify(list.data.map((w) => w.id))}` };
        }
        return { ok: true, data: found };
    }
    const visible = list.data.find((w) => w.isVisible);
    return { ok: true, data: visible ?? list.data[0] };
}
/**
 * Evaluate a JavaScript expression in a WebView's page context.
 * Returns the raw result (mobilecli serializes it to a string).
 */
export async function evalWebview(udid, webviewId, expression) {
    const bin = await resolveMobilecli();
    if (!bin)
        return { ok: false, error: NO_BACKEND };
    const r = await run(bin, ["webview", "eval", webviewId, expression, "--device", udid], {
        timeout: 20_000,
    });
    if (r.code !== 0)
        return { ok: false, error: r.stderr || r.stdout };
    const data = parseEnvelope(r.stdout);
    return { ok: true, data: data ?? r.stdout.trim() };
}
/**
 * Resolve a CSS selector to on-screen-tappable DOM elements.
 *
 * Runs a single `eval` that maps each match to {tag,id,text,rect} (CSS px,
 * viewport-relative), then offsets by the WebView's on-screen bounds to produce
 * absolute logical-point tap coordinates. Zero-size elements are dropped.
 */
export async function inspectWebview(udid, selector, webviewId, max = 100) {
    const wv = await resolveWebview(udid, webviewId);
    if (!wv.ok)
        return wv;
    // Build the in-page extractor. selector is embedded as a JSON string literal,
    // so quotes/specials are safe; the whole expression is passed verbatim
    // (execFile, no shell) to mobilecli.
    const sel = JSON.stringify(selector);
    const expr = `JSON.stringify([].slice.call(document.querySelectorAll(${sel})).map(function(e){` +
        `var r=e.getBoundingClientRect();` +
        `return{tag:e.tagName.toLowerCase(),id:e.id||null,` +
        `text:((e.innerText||e.value||e.getAttribute('aria-label')||'')+'').replace(/\\s+/g,' ').trim().slice(0,80),` +
        `rect:{x:r.x,y:r.y,w:r.width,h:r.height}};` +
        `}).filter(function(e){return e.rect.w>0&&e.rect.h>0;}))`;
    const ev = await evalWebview(udid, wv.data.id, expr);
    if (!ev.ok)
        return ev;
    let raw;
    try {
        raw = JSON.parse(ev.data);
    }
    catch {
        return { ok: false, error: `webview eval returned non-JSON: ${ev.data.slice(0, 200)}` };
    }
    const bx = wv.data.bounds?.x ?? 0;
    const by = wv.data.bounds?.y ?? 0;
    const truncated = raw.length > max;
    const elements = raw.slice(0, max).map((e) => ({
        tag: e.tag,
        id: e.id,
        text: e.text,
        rect: e.rect,
        tapX: Math.round(bx + e.rect.x + e.rect.w / 2),
        tapY: Math.round(by + e.rect.y + e.rect.h / 2),
    }));
    return { ok: true, data: { webview: wv.data, count: raw.length, elements, truncated } };
}
/** Navigate a WebView: goto <url> | back | forward | reload. */
export async function navigateWebview(udid, webviewId, action, url) {
    const bin = await resolveMobilecli();
    if (!bin)
        return { ok: false, error: NO_BACKEND };
    const args = ["webview", action, webviewId];
    if (action === "goto") {
        if (!url)
            return { ok: false, error: "webview_navigate: action 'goto' requires a url." };
        args.push(url);
    }
    args.push("--device", udid);
    const r = await run(bin, args, { timeout: 20_000 });
    if (r.code !== 0)
        return { ok: false, error: r.stderr || r.stdout };
    return { ok: true, data: { action, ...(url ? { url } : {}) } };
}

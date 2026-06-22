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
    const r = await run(bin, ["webview", "list", "--device", udid], { timeout: 30_000 });
    const raw = (r.stdout || r.stderr || "").trim();
    // mobilecli emits {status,data} on success or {status:"error",error} on failure —
    // sometimes on stdout, sometimes stderr, and not always with a non-zero exit code.
    // Surface mobilecli's actual error (e.g. the WebDriverAgent/DeviceKit requirement)
    // instead of a generic "unparseable" so the agent gets an actionable message.
    try {
        const p = JSON.parse(raw);
        if (p.status === "error" || p.error) {
            return { ok: false, error: webviewError(p.error ?? "webview list failed") };
        }
        if (Array.isArray(p.data))
            return { ok: true, data: p.data };
    }
    catch {
        // not JSON — fall through to the raw-output path
    }
    if (r.code !== 0 && raw)
        return { ok: false, error: webviewError(raw.slice(0, 300)) };
    if (!raw) {
        return {
            ok: false,
            error: "webview list returned no output — mobilecli's WebView backend (WebDriverAgent/DeviceKit) " +
                "is likely not running. Start it (e.g. `mobilecli devicekit start` / ensure WebDriverAgent " +
                "is installed on the simulator) and retry.",
        };
    }
    return { ok: false, error: `unparseable webview list: ${raw.slice(0, 300)}` };
}
/** Append an actionable hint when mobilecli reports the WebDriverAgent/DeviceKit prerequisite. */
function webviewError(msg) {
    if (/DeviceKit|WebDriverAgent/i.test(msg)) {
        return `${msg}. WebView tools need mobilecli's WebDriverAgent/DeviceKit running on the simulator — start it and retry, or use a screenshot + coordinate tap as a fallback.`;
    }
    return msg;
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
            error: "no inspectable WebView found on this device. Likely causes: (1) the app hosts no " +
                "WKWebView, or (2) the WebView has isInspectable=false (the default in production / App " +
                "Store builds). To enable: set `webView.isInspectable = true` (iOS 16.4+) in a debug or " +
                "staging build and relaunch. Fallback when you cannot enable it: capture a screenshot, " +
                "locate the element visually, and tap via tap_on / tap_with_fallback using x/y coordinates.",
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
// ─── WebView network capture (fetch/XHR interceptor) ─────────────────────────
//
// mobilecli has no "webview network" command, but it does expose `webview eval`.
// For WebView-based apps (an RN shell hosting its UI in a WKWebView), the app's
// HTTP traffic runs in the WEB layer — so the CDP Network domain that
// metro_network instruments sees nothing. The portable fix is a JS interceptor:
// inject a recorder that patches fetch + XMLHttpRequest, let the agent drive the
// app, then read back the buffer and emit a (redacted) HAR. Only requests made
// AFTER injection are captured.
/** In-page recorder, injected via eval. Monkey-patches fetch + XHR to log
 *  request/response metadata into window.__podiumNet. Idempotent; resets the
 *  buffer on (re)install so each capture window starts clean. A single
 *  expression (IIFE) — passed verbatim (execFile, no shell) to mobilecli. */
const WEBVIEW_NET_SHIM = `(function(){
  var cap=300, hdrs=function(h){var o={};try{if(h&&h.forEach)h.forEach(function(v,k){o[k]=v});else if(h&&typeof h==='object')for(var k in h)o[k]=h[k]}catch(e){}return o};
  var now=function(){return (typeof performance!=='undefined'&&performance.now)?performance.now():Date.now()};
  if(window.__podiumNetInstalled){window.__podiumNet=[];return 'reset'}
  window.__podiumNetInstalled=true; window.__podiumNet=[];
  try{performance.setResourceTimingBufferSize(3000)}catch(e){}
  var push=function(e){if(window.__podiumNet.length<cap)window.__podiumNet.push(e)};
  if(window.fetch&&!window.fetch.__podium){var of=window.fetch;
    var nf=function(input,init){var url=(typeof input==='string')?input:((input&&input.url)||'');
      var m=(init&&init.method)||(input&&input.method)||'GET';
      var rec={u:url,m:m,q:hdrs(init&&init.headers),w:Date.now()/1000};
      if(init&&typeof init.body==='string')rec.b=init.body;
      var t0=now();
      return of.apply(this,arguments).then(function(res){try{rec.s=res.status;rec.st=res.statusText;rec.h=hdrs(res.headers);rec.ct=(res.headers&&res.headers.get)?res.headers.get('content-type'):''}catch(e){}rec.d=now()-t0;push(rec);return res},
        function(err){rec.s=0;rec.d=now()-t0;push(rec);throw err})};
    nf.__podium=true;window.fetch=nf}
  if(window.XMLHttpRequest&&!window.XMLHttpRequest.__podium){var OX=window.XMLHttpRequest;
    function PX(){var x=new OX(),rec={m:'GET',u:'',q:{}},t0=0;
      var oo=x.open;x.open=function(m,u){rec.m=m;rec.u=u;return oo.apply(x,arguments)};
      var os=x.send;x.send=function(b){if(typeof b==='string')rec.b=b;rec.w=Date.now()/1000;t0=now();
        x.addEventListener('loadend',function(){try{rec.s=x.status;rec.ct=x.getResponseHeader&&x.getResponseHeader('content-type');var rh={};(x.getAllResponseHeaders()||'').trim().split(/\\r?\\n/).forEach(function(l){var i=l.indexOf(':');if(i>0)rh[l.slice(0,i).trim()]=l.slice(i+1).trim()});rec.h=rh}catch(e){}rec.d=now()-t0;push(rec)});
        return os.apply(x,arguments)};
      return x}
    PX.__podium=true;try{PX.prototype=OX.prototype}catch(e){}window.XMLHttpRequest=PX}
  return 'installed'})()`;
/** Map raw shim records → NetworkEntry[] (pure + exported for unit tests). The
 *  measured duration goes into a synthetic ResourceTiming `receiveHeadersEnd` so
 *  toHar derives a real `time` (wait span). */
export function mapWebviewNetRecords(recs) {
    return recs.map((r, i) => ({
        requestId: String(i),
        url: r.u || "",
        method: r.m || "GET",
        ts: i,
        ...(typeof r.s === "number" ? { status: r.s } : {}),
        ...(r.st ? { statusText: r.st } : {}),
        ...(r.ct ? { mimeType: r.ct } : {}),
        ...(typeof r.w === "number" ? { wallTime: r.w } : {}),
        ...(r.q && Object.keys(r.q).length ? { requestHeaders: r.q } : {}),
        ...(r.h && Object.keys(r.h).length ? { responseHeaders: r.h } : {}),
        ...(r.b !== undefined && r.b !== null ? { postData: String(r.b) } : {}),
        ...(typeof r.d === "number" ? { timing: { sendStart: 0, sendEnd: 0, receiveHeadersEnd: r.d } } : {}),
    }));
}
/** Reads the browser's Performance Resource Timing buffer — every network
 *  request the document made SINCE NAVIGATION, including ones that fired before
 *  the fetch/XHR recorder was injected. No headers/bodies (the API doesn't expose
 *  them), but full URL + initiatorType + timing + transfer size, and responseStatus
 *  on newer WebKit. timeOrigin+startTime gives a real epoch for HAR startedDateTime. */
const WEBVIEW_RESOURCE_READ = "JSON.stringify(((typeof performance!=='undefined'&&performance.getEntriesByType)?performance.getEntriesByType('resource'):[]).map(function(e){" +
    "return{u:e.name,it:e.initiatorType,d:Math.round(e.duration),sz:e.transferSize,st:e.responseStatus,w:(performance.timeOrigin+e.startTime)/1000}}))";
/** Map resource-timing records → NetworkEntry[] (pure). These carry URL/timing/
 *  size but no headers or body (the API doesn't expose them); initiatorType is
 *  surfaced as the mimeType hint (e.g. 'script', 'xmlhttprequest', 'img'). */
export function mapResourceRecords(recs) {
    return recs
        .filter((r) => r.u)
        .map((r, i) => ({
        requestId: "res-" + i,
        url: r.u,
        method: "GET",
        ts: typeof r.w === "number" ? r.w : i,
        ...(typeof r.st === "number" && r.st > 0 ? { status: r.st } : {}),
        ...(r.it ? { mimeType: r.it } : {}),
        ...(typeof r.w === "number" ? { wallTime: r.w } : {}),
        ...(typeof r.sz === "number" && r.sz > 0 ? { encodedDataLength: r.sz } : {}),
        ...(typeof r.d === "number" ? { timing: { sendStart: 0, sendEnd: 0, receiveHeadersEnd: r.d } } : {}),
    }));
}
/** Merge rich fetch/XHR records with retroactive resource-timing records.
 *  A URL captured by the fetch/XHR hook (rich: method/status/headers/body) wins
 *  over the same URL from resource timing (URL/timing only) — pure + testable. */
export function mergeWebviewNetwork(xhr, resources) {
    const rich = mapWebviewNetRecords(xhr);
    const seen = new Set(rich.map((e) => e.url));
    const resEntries = mapResourceRecords(resources).filter((e) => !seen.has(e.url));
    return [...rich, ...resEntries];
}
/** Inject the recorder into a WebView, capture for durationMs, then merge the
 *  live fetch/XHR records with the browser's retroactive Performance Resource
 *  Timing buffer for a complete request list. Never throws.
 *
 *  includeResources (default true) adds every request the document made since
 *  navigation — including those that fired BEFORE injection — closing the
 *  "forward-only" gap. Set false for fetch/XHR only (headers + bodies). */
export async function webviewNetworkCapture(udid, webviewId, durationMs, opts = {}) {
    const inject = await evalWebview(udid, webviewId, WEBVIEW_NET_SHIM);
    if (!inject.ok)
        return inject;
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    const read = await evalWebview(udid, webviewId, "JSON.stringify(window.__podiumNet||[])");
    if (!read.ok)
        return read;
    let recs;
    try {
        recs = JSON.parse(read.data);
    }
    catch {
        return { ok: false, error: `webview network buffer was not JSON: ${read.data.slice(0, 200)}` };
    }
    if (!Array.isArray(recs))
        return { ok: false, error: "webview network buffer was not an array" };
    if (opts.includeResources === false) {
        return { ok: true, data: mapWebviewNetRecords(recs) };
    }
    // Best-effort retroactive resource list; if it fails, fall back to fetch/XHR only.
    const resRead = await evalWebview(udid, webviewId, WEBVIEW_RESOURCE_READ);
    let resources = [];
    if (resRead.ok) {
        try {
            const parsed = JSON.parse(resRead.data);
            if (Array.isArray(parsed))
                resources = parsed;
        }
        catch {
            // ignore — resource timing is a best-effort augmentation
        }
    }
    return { ok: true, data: mergeWebviewNetwork(recs, resources) };
}

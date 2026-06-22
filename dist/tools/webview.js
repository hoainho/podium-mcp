import { z } from "zod";
import { writeFile } from "node:fs/promises";
import { inspectWebview, evalWebview, navigateWebview, resolveWebview, webviewNetworkCapture } from "../lib/webview.js";
import { toHar, redactNetworkEntries } from "../lib/har.js";
import { errorResult, okResult } from "../lib/result.js";
const INSPECTABLE_NOTE = " Requires the app's WKWebView to be inspectable (isInspectable=true) — on by " +
    "default in debug/staging builds, frequently disabled in production App Store builds.";
export function registerWebviewTools(server) {
    // ─── webview_inspect ───────────────────────────────────────────────────────
    server.tool("webview_inspect", "Lists embedded WebViews (WKWebView) on a booted simulator and, for the selected one, " +
        "resolves a CSS selector to DOM elements WITH absolute on-screen tap coordinates. " +
        "This is the answer to the 'WebView content is opaque' limitation of the coordinate " +
        "tools: instead of eyeballing a screenshot, get tapX/tapY for a real DOM element and " +
        "feed it straight into tap_on. Defaults to interactive elements when no selector is given." +
        INSPECTABLE_NOTE, {
        udid: z.string().describe("Simulator / device UDID (from device_list)"),
        selector: z
            .string()
            .optional()
            .describe("CSS selector (default: 'button, a, input, textarea, [role=button]')"),
        webviewId: z
            .string()
            .optional()
            .describe("Target WebView id (from a prior call). Omit to auto-select the first visible WebView."),
        max: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional()
            .describe("Maximum elements to return (default 100)"),
    }, async ({ udid, selector, webviewId, max }) => {
        const result = await inspectWebview(udid, selector ?? "button, a, input, textarea, [role=button]", webviewId, max ?? 100);
        if (!result.ok)
            return errorResult(result.error);
        return okResult(result.data);
    });
    // ─── webview_eval ──────────────────────────────────────────────────────────
    server.tool("webview_eval", "Evaluates a JavaScript expression in a WebView's page context and returns the result. " +
        "Use it to read web-app state (location.href, store values, feature flags, on-screen " +
        "balances) or to assert conditions against the live DOM." +
        INSPECTABLE_NOTE, {
        udid: z.string().describe("Simulator / device UDID"),
        expression: z
            .string()
            .describe("JavaScript expression to evaluate, e.g. \"location.href\" or \"document.querySelectorAll('button').length\""),
        webviewId: z
            .string()
            .optional()
            .describe("Target WebView id. Omit to auto-select the first visible WebView."),
    }, async ({ udid, expression, webviewId }) => {
        // Operational lockdown: arbitrary JS eval can be disabled for hardened deployments.
        if (process.env.PODIUM_DISABLE_WEBVIEW_EVAL === "1") {
            return errorResult("webview_eval is disabled (PODIUM_DISABLE_WEBVIEW_EVAL=1). Unset it to allow arbitrary JS evaluation in inspectable WebViews.");
        }
        const wv = await resolveWebview(udid, webviewId);
        if (!wv.ok)
            return errorResult(wv.error);
        const result = await evalWebview(udid, wv.data.id, expression);
        if (!result.ok)
            return errorResult(result.error);
        return okResult({ webviewId: wv.data.id, url: wv.data.url, result: result.data });
    });
    // ─── webview_navigate ──────────────────────────────────────────────────────
    server.tool("webview_navigate", "Drives a WebView's navigation: goto a URL, or back / forward / reload." + INSPECTABLE_NOTE, {
        udid: z.string().describe("Simulator / device UDID"),
        action: z
            .enum(["goto", "back", "forward", "reload"])
            .describe("Navigation action. 'goto' requires url."),
        url: z.string().url().optional().describe("Destination URL (required when action is 'goto')"),
        webviewId: z
            .string()
            .optional()
            .describe("Target WebView id. Omit to auto-select the first visible WebView."),
    }, async ({ udid, action, url, webviewId }) => {
        if (action === "goto" && !url) {
            return errorResult("webview_navigate: action 'goto' requires a url.");
        }
        const wv = await resolveWebview(udid, webviewId);
        if (!wv.ok)
            return errorResult(wv.error);
        const result = await navigateWebview(udid, wv.data.id, action, url);
        if (!result.ok)
            return errorResult(result.error);
        return okResult({ webviewId: wv.data.id, ...result.data });
    });
    // ─── webview_network ─────────────────────────────────────────────────────────
    server.tool("webview_network", "Captures HTTP traffic made INSIDE a WebView (fetch + XMLHttpRequest) and exports it as JSON or a " +
        "redacted HAR 1.2 log. This is the network-debugging path for WebView-based apps — RN shells that host " +
        "their UI in a WKWebView, where the API calls run in the web layer so metro_network (CDP Network domain) " +
        "captures nothing. It injects a fetch/XHR recorder into the page, captures for durationMs while you drive " +
        "the app, then returns request/response metadata (url, method, status, headers, timing). Only requests made " +
        "AFTER capture starts are recorded. format:'har' emits a valid HAR 1.2 log (HAR-lite — no response bodies) " +
        "openable in Chrome DevTools → Import HAR; pass saveTo to write the .har file. Sensitive headers " +
        "(authorization/cookie/…) and request bodies are REDACTED by default — set redact:false to keep them " +
        "(don't commit unredacted HAR: it leaks tokens)." +
        INSPECTABLE_NOTE, {
        udid: z.string().describe("Simulator / device UDID"),
        webviewId: z
            .string()
            .optional()
            .describe("Target WebView id. Omit to auto-select the first visible WebView."),
        durationMs: z
            .number()
            .int()
            .min(100)
            .max(60000)
            .optional()
            .describe("How long to capture (ms) while you drive the app (default 5000)"),
        format: z
            .enum(["json", "har"])
            .optional()
            .describe("Output format: 'json' (default, structured entries) or 'har' (HAR 1.2 log)."),
        saveTo: z
            .string()
            .optional()
            .describe("Optional file path to write the output (a .har file when format:'har')."),
        redact: z
            .boolean()
            .optional()
            .describe("Mask sensitive headers (authorization/cookie/…) and request bodies. Default true."),
        includeResources: z
            .boolean()
            .optional()
            .describe("Also include the browser's retroactive Performance Resource Timing list — EVERY request the document " +
            "made since navigation, including ones that fired before capture started (URL + timing + size, but no " +
            "headers/body). Default true. Set false for fetch/XHR only (with full headers + bodies)."),
    }, async ({ udid, webviewId, durationMs, format, saveTo, redact, includeResources }) => {
        // The recorder is injected via JS eval — respect the same operational lockdown.
        if (process.env.PODIUM_DISABLE_WEBVIEW_EVAL === "1") {
            return errorResult("webview_network is disabled (PODIUM_DISABLE_WEBVIEW_EVAL=1): it injects a JS recorder via eval. Unset it to allow WebView network capture.");
        }
        const wv = await resolveWebview(udid, webviewId);
        if (!wv.ok)
            return errorResult(wv.error);
        const cap = await webviewNetworkCapture(udid, wv.data.id, durationMs ?? 5000, {
            includeResources: includeResources !== false,
        });
        if (!cap.ok)
            return errorResult(cap.error);
        if (format === "har") {
            const har = toHar(cap.data, { redact });
            let savedTo;
            if (saveTo) {
                try {
                    await writeFile(saveTo, JSON.stringify(har, null, 2), "utf8");
                    savedTo = saveTo;
                }
                catch (e) {
                    return errorResult(`webview_network: failed to write ${saveTo}: ${String(e)}`);
                }
            }
            return okResult({
                webviewId: wv.data.id,
                url: wv.data.url,
                format: "har",
                count: cap.data.length,
                redacted: redact !== false,
                ...(savedTo ? { savedTo } : {}),
                har,
            });
        }
        const entries = redactNetworkEntries(cap.data, { redact });
        let savedTo;
        if (saveTo) {
            try {
                await writeFile(saveTo, JSON.stringify(entries, null, 2), "utf8");
                savedTo = saveTo;
            }
            catch (e) {
                return errorResult(`webview_network: failed to write ${saveTo}: ${String(e)}`);
            }
        }
        return okResult({
            webviewId: wv.data.id,
            url: wv.data.url,
            count: entries.length,
            redacted: redact !== false,
            ...(savedTo ? { savedTo } : {}),
            requests: entries,
        });
    });
}

import { z } from "zod";
import { checkVisible } from "../lib/oracle.js";
import { errorResult, okResult } from "../lib/result.js";
/**
 * First-class assertion + wait tools — the "trustworthy verdict" primitives.
 * All route through lib/oracle.checkVisible (precedence: WebView-DOM > native
 * a11y > Maestro; screenshots never). A verdict that can't be verified returns a
 * distinct error rather than a silent pass — so the AI's "it works" is auditable.
 */
const target = {
    udid: z.string().describe("Simulator UDID"),
    text: z.string().optional().describe("Visible text to match (native a11y / WebView innerText)"),
    selector: z.string().optional().describe("CSS selector — WebView surfaces only"),
    bundleId: z.string().optional().describe("App bundle id for the Maestro fallback (native surface)"),
    contains: z
        .boolean()
        .optional()
        .describe("Substring match for text (default false = exact full-string on native a11y). WebView innerText is always substring."),
};
export function registerAssertTools(server) {
    server.tool("assert_visible", "Asserts an element/text is visible, via the oracle ladder (WebView-DOM > native a11y > Maestro). " +
        "Passes only when a capable oracle confirms presence; if the surface is a WebView whose DOM can't be " +
        "read (isInspectable=false), returns an 'unverifiable' error instead of a false pass. Provide text (any " +
        "surface) or selector (WebView).", { ...target, timeoutMs: z.number().int().min(0).max(120000).optional().describe("Poll budget (default 3000)") }, async ({ udid, text, selector, bundleId, timeoutMs, contains }) => {
        if (!text && !selector)
            return errorResult("assert_visible requires text or selector.");
        const r = await checkVisible(udid, { text, selector }, { timeoutMs, bundleId, contains });
        if (r.visible === true)
            return okResult({ ok: true, visible: true, via: r.via, ...(text ? { text } : {}), ...(selector ? { selector } : {}) });
        if (r.visible === null)
            return errorResult(`assert_visible: UNVERIFIABLE (${r.via}) — could not read the target. WebView may not be inspectable; pass a selector or enable isInspectable in a debug build.`);
        return errorResult(`assert_visible: NOT visible (oracle: ${r.via}).`);
    });
    server.tool("assert_text", "Asserts the given text is visible on screen (by-text shorthand for assert_visible). Same oracle ladder + " +
        "unverifiable handling.", { udid: target.udid, text: z.string().describe("Visible text to assert"), bundleId: target.bundleId, contains: target.contains, timeoutMs: z.number().int().min(0).max(120000).optional() }, async ({ udid, text, bundleId, timeoutMs, contains }) => {
        const r = await checkVisible(udid, { text }, { timeoutMs, bundleId, contains });
        if (r.visible === true)
            return okResult({ ok: true, visible: true, via: r.via, text });
        if (r.visible === null)
            return errorResult(`assert_text: UNVERIFIABLE (${r.via}) — could not read the target (WebView not inspectable?).`);
        return errorResult(`assert_text: "${text}" NOT visible (oracle: ${r.via}).`);
    });
    server.tool("assert_not_visible", "Asserts an element/text is ABSENT. FAILS CLOSED: if absence cannot be verified (e.g. a WebView whose DOM " +
        "is unreadable — native a11y is blind to web content), returns an 'unverifiable' error rather than a false " +
        "pass. Passes only when a capable oracle confirms absence.", { ...target, timeoutMs: z.number().int().min(0).max(120000).optional().describe("Confirmation budget (default 1500)") }, async ({ udid, text, selector, bundleId, timeoutMs, contains }) => {
        if (!text && !selector)
            return errorResult("assert_not_visible requires text or selector.");
        const r = await checkVisible(udid, { text, selector }, { timeoutMs: timeoutMs ?? 1500, bundleId, contains });
        if (r.visible === false)
            return okResult({ ok: true, notVisible: true, via: r.via, ...(text ? { text } : {}), ...(selector ? { selector } : {}) });
        if (r.visible === null)
            return errorResult(`assert_not_visible: UNVERIFIABLE (${r.via}) — refusing to assert absence (fail-closed). The WebView DOM could not be read; an empty native tree is NOT proof of absence.`);
        return errorResult(`assert_not_visible: target is STILL visible (oracle: ${r.via}).`);
    });
    server.tool("wait_for_element", "Polls until an element/text is visible (via the oracle ladder), or fails on timeout. Use to act the instant " +
        "the UI is ready instead of a blind sleep.", { ...target, timeoutMs: z.number().int().min(0).max(120000).optional().describe("Wait budget (default 10000)") }, async ({ udid, text, selector, bundleId, timeoutMs, contains }) => {
        if (!text && !selector)
            return errorResult("wait_for_element requires text or selector.");
        const budget = timeoutMs ?? 10000;
        const r = await checkVisible(udid, { text, selector }, { timeoutMs: budget, bundleId, contains });
        if (r.visible === true)
            return okResult({ ok: true, visible: true, via: r.via });
        if (r.visible === null)
            return errorResult(`wait_for_element: UNVERIFIABLE (${r.via}) — could not read the target (WebView not inspectable?).`);
        return errorResult(`wait_for_element: not visible within ${budget}ms (oracle: ${r.via}).`);
    });
}

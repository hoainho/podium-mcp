import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { inspectWebview, evalWebview, navigateWebview, resolveWebview } from "../lib/webview.js";
import { errorResult, okResult } from "../lib/result.js";

const INSPECTABLE_NOTE =
  " Requires the app's WKWebView to be inspectable (isInspectable=true) — on by " +
  "default in debug/staging builds, frequently disabled in production App Store builds.";

export function registerWebviewTools(server: McpServer): void {
  // ─── webview_inspect ───────────────────────────────────────────────────────
  server.tool(
    "webview_inspect",
    "Lists embedded WebViews (WKWebView) on a booted simulator and, for the selected one, " +
      "resolves a CSS selector to DOM elements WITH absolute on-screen tap coordinates. " +
      "This is the answer to the 'WebView content is opaque' limitation of the coordinate " +
      "tools: instead of eyeballing a screenshot, get tapX/tapY for a real DOM element and " +
      "feed it straight into tap_on. Defaults to interactive elements when no selector is given." +
      INSPECTABLE_NOTE,
    {
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
    },
    async ({ udid, selector, webviewId, max }) => {
      const result = await inspectWebview(
        udid,
        selector ?? "button, a, input, textarea, [role=button]",
        webviewId,
        max ?? 100
      );
      if (!result.ok) return errorResult(result.error);
      return okResult(result.data);
    }
  );

  // ─── webview_eval ──────────────────────────────────────────────────────────
  server.tool(
    "webview_eval",
    "Evaluates a JavaScript expression in a WebView's page context and returns the result. " +
      "Use it to read web-app state (location.href, store values, feature flags, on-screen " +
      "balances) or to assert conditions against the live DOM." +
      INSPECTABLE_NOTE,
    {
      udid: z.string().describe("Simulator / device UDID"),
      expression: z
        .string()
        .describe("JavaScript expression to evaluate, e.g. \"location.href\" or \"document.querySelectorAll('button').length\""),
      webviewId: z
        .string()
        .optional()
        .describe("Target WebView id. Omit to auto-select the first visible WebView."),
    },
    async ({ udid, expression, webviewId }) => {
      const wv = await resolveWebview(udid, webviewId);
      if (!wv.ok) return errorResult(wv.error);
      const result = await evalWebview(udid, wv.data.id, expression);
      if (!result.ok) return errorResult(result.error);
      return okResult({ webviewId: wv.data.id, url: wv.data.url, result: result.data });
    }
  );

  // ─── webview_navigate ──────────────────────────────────────────────────────
  server.tool(
    "webview_navigate",
    "Drives a WebView's navigation: goto a URL, or back / forward / reload." + INSPECTABLE_NOTE,
    {
      udid: z.string().describe("Simulator / device UDID"),
      action: z
        .enum(["goto", "back", "forward", "reload"])
        .describe("Navigation action. 'goto' requires url."),
      url: z.string().url().optional().describe("Destination URL (required when action is 'goto')"),
      webviewId: z
        .string()
        .optional()
        .describe("Target WebView id. Omit to auto-select the first visible WebView."),
    },
    async ({ udid, action, url, webviewId }) => {
      if (action === "goto" && !url) {
        return errorResult("webview_navigate: action 'goto' requires a url.");
      }
      const wv = await resolveWebview(udid, webviewId);
      if (!wv.ok) return errorResult(wv.error);
      const result = await navigateWebview(udid, wv.data.id, action, url);
      if (!result.ok) return errorResult(result.error);
      return okResult({ webviewId: wv.data.id, ...result.data });
    }
  );
}

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkVisible } from "../lib/oracle.js";
import { listMetroApps, readNetwork, readConsoleLogs } from "../lib/metro.js";
import { listCrashes } from "../lib/crash.js";
import { errorResult, okResult } from "../lib/result.js";

/**
 * validate_flow — the engineer-inner-loop "it works?" verdict.
 *
 * Operationalizes "it works" as a FALSIFIABLE, evidenced verdict (never "looks
 * ok"): caller-supplied visibility assertions (via the oracle ladder) AND
 * automatic health checks — no recent crash, no error-level Metro console logs,
 * no failed/≥400 network requests during a short sample. ok=true only when every
 * assertion passes AND every applicable auto-check is clean. Metro checks are
 * skipped (not failed) when no RN app is connected.
 */
const assertionSchema = z.object({
  kind: z.enum(["visible", "not_visible"]).describe("Assert the target is visible or absent"),
  text: z.string().optional().describe("Visible text to match"),
  selector: z.string().optional().describe("CSS selector (WebView surfaces)"),
  contains: z.boolean().optional().describe("Substring text match (default exact)"),
});

export function registerValidateTools(server: McpServer): void {
  server.tool(
    "validate_flow",
    "Returns a trustworthy, evidenced verdict on whether a just-implemented flow works. Runs your " +
      "visibility assertions through the oracle ladder (WebView-DOM > native a11y > Maestro; fail-closed " +
      "on unverifiable) AND auto-checks app health: no recent crash, no error-level Metro logs, no failed " +
      "(≥400) network requests. ok=true only when ALL assertions pass AND all applicable auto-checks are " +
      "clean — never a bare 'looks ok'. State the expected outcome as assertions; this tool makes the AI's " +
      "'it works' auditable.",
    {
      udid: z.string().describe("Simulator UDID"),
      assertions: z.array(assertionSchema).optional().describe("Expected-outcome assertions (≥1 recommended)"),
      bundleId: z.string().optional().describe("App bundle id (Maestro fallback)"),
      metroPort: z.number().int().min(1).max(65535).optional().describe("Metro port for log/network checks (default 8081)"),
      sinceSeconds: z.number().int().min(1).max(3600).optional().describe("Crash-recency window in seconds (default 120)"),
      checkCrashes: z.boolean().optional().describe("Auto-check recent crashes (default true)"),
      checkNetwork: z.boolean().optional().describe("Auto-check failed network requests (default true)"),
      checkLogs: z.boolean().optional().describe("Auto-check error-level console logs (default true)"),
    },
    async ({ udid, assertions, bundleId, metroPort, sinceSeconds, checkCrashes, checkNetwork, checkLogs }) => {
      const asserts = assertions ?? [];
      if (asserts.length === 0 && checkCrashes === false && checkNetwork === false && checkLogs === false) {
        return errorResult("validate_flow: nothing to check — provide assertions or leave auto-checks enabled.");
      }

      // 1. Assertions via the oracle ladder.
      const assertionResults = [];
      for (const a of asserts) {
        if (!a.text && !a.selector) return errorResult("validate_flow: each assertion needs text or selector.");
        const r = await checkVisible(udid, { text: a.text, selector: a.selector }, { contains: a.contains, bundleId });
        const pass = a.kind === "not_visible" ? r.visible === false : r.visible === true;
        assertionResults.push({ kind: a.kind, ...(a.text ? { text: a.text } : {}), ...(a.selector ? { selector: a.selector } : {}), pass, via: r.via, verifiable: r.visible !== null });
      }

      // 2. Auto health checks (evidence).
      const autoChecks: Array<{ name: string; ok: boolean; skipped?: boolean; detail: string }> = [];

      if (checkCrashes !== false) {
        const crashes = await listCrashes({ sinceHours: (sinceSeconds ?? 120) / 3600, udid });
        autoChecks.push({ name: "crashes", ok: crashes.length === 0, detail: `${crashes.length} recent crash report(s)` });
      }

      if (checkNetwork !== false || checkLogs !== false) {
        const apps = await listMetroApps(metroPort ?? 8081);
        if ("error" in apps || apps.length === 0) {
          autoChecks.push({ name: "metro", ok: true, skipped: true, detail: "no RN app connected to Metro — network/log checks skipped" });
        } else {
          const ws = apps[0].webSocketDebuggerUrl;
          if (checkNetwork !== false) {
            const net = await readNetwork(ws, { durationMs: 1500 });
            const failed = "requests" in net ? net.requests.filter((q) => typeof q.status === "number" && q.status >= 400) : [];
            autoChecks.push({ name: "failedRequests", ok: failed.length === 0, detail: `${failed.length} request(s) with status ≥400` });
          }
          if (checkLogs !== false) {
            const logs = await readConsoleLogs(ws, { durationMs: 1500 });
            const errs = "logs" in logs ? logs.logs.filter((l) => /error/i.test(l.level)) : [];
            autoChecks.push({ name: "errorLogs", ok: errs.length === 0, detail: `${errs.length} error-level console log(s)` });
          }
        }
      }

      const ok = assertionResults.every((r) => r.pass) && autoChecks.every((c) => c.ok);
      return okResult({ ok, assertions: assertionResults, autoChecks });
    }
  );
}

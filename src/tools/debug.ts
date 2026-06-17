import { z } from "zod";
import { writeFile } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { run } from "../lib/exec.js";
import { listMetroApps, readConsoleLogs, readNetwork, evalRuntime } from "../lib/metro.js";
import { toHar, redactNetworkEntries } from "../lib/har.js";
import { listCrashes, getCrash } from "../lib/crash.js";
import { listApps } from "../lib/simctl.js";
import { errorResult, okResult } from "../lib/result.js";

/** Escape a string for safe use as a literal inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve the CDP WebSocket URL for the metro_* tools: use the explicit URL when
 * given, else auto-discover the first connected app via metro_apps. Shared by
 * metro_logs / metro_network / metro_state.
 */
async function resolveMetroWs(
  webSocketDebuggerUrl: string | undefined,
  port: number | undefined
): Promise<{ wsUrl: string; chosenApp?: string } | { error: string }> {
  if (webSocketDebuggerUrl) return { wsUrl: webSocketDebuggerUrl };
  const apps = await listMetroApps(port ?? 8081);
  if ("error" in apps) return { error: apps.error };
  if (apps.length === 0) return { error: "metro_apps found no connected apps" };
  const first = apps[0];
  return { wsUrl: first.webSocketDebuggerUrl, chosenApp: first.title || first.description || first.id };
}

export function registerDebugTools(server: McpServer): void {
  // ─── metro_apps ──────────────────────────────────────────────────────────────
  server.tool(
    "metro_apps",
    "Lists React Native apps currently connected to a Metro bundler inspector. Returns CDP-style targets (id, title, webSocketDebuggerUrl). Returns a structured error if Metro is not running on the given port.",
    {
      port: z
        .number()
        .int()
        .min(1)
        .max(65535)
        .optional()
        .describe("Metro dev server port (default 8081)"),
    },
    async ({ port }) => {
      const result = await listMetroApps(port ?? 8081);
      if ("error" in result) {
        return errorResult(result.error);
      }
      return okResult(result);
    }
  );

  // ─── metro_logs ──────────────────────────────────────────────────────────────
  server.tool(
    "metro_logs",
    "Reads console logs from a React Native app via the Metro CDP debugger. If webSocketDebuggerUrl is omitted, auto-discovers via metro_apps and uses the first connected app. Reports which app was chosen. Pass saveTo to also write the console timeline to a file for evidence (e.g. attach to a bug).",
    {
      webSocketDebuggerUrl: z
        .string()
        .optional()
        .describe("CDP WebSocket URL from metro_apps. Omit to auto-discover."),
      port: z
        .number()
        .int()
        .min(1)
        .max(65535)
        .optional()
        .describe("Metro port for auto-discovery (default 8081)"),
      durationMs: z
        .number()
        .int()
        .min(100)
        .max(30000)
        .optional()
        .describe("How long to collect logs in milliseconds (default 3000)"),
      maxLogs: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe("Maximum number of log entries to return (default 100, keeps most recent)"),
      saveTo: z
        .string()
        .optional()
        .describe("Optional file path; writes the console timeline (one line per entry: [level ts] text) for evidence."),
    },
    async ({ webSocketDebuggerUrl, port, durationMs, maxLogs, saveTo }) => {
      const disc = await resolveMetroWs(webSocketDebuggerUrl, port);
      if ("error" in disc) return errorResult(disc.error);
      const { wsUrl, chosenApp } = disc;

      const result = await readConsoleLogs(wsUrl, { durationMs, maxLogs });
      if ("error" in result) {
        return errorResult(result.error);
      }

      let savedTo: string | undefined;
      if (saveTo) {
        const text = result.logs.map((l) => `[${l.level} ${l.ts}] ${l.text}`).join("\n") + "\n";
        try {
          await writeFile(saveTo, text, "utf8");
          savedTo = saveTo;
        } catch (e) {
          return errorResult(`metro_logs: failed to write ${saveTo}: ${String(e)}`);
        }
      }

      return okResult({
        ...(chosenApp ? { chosenApp } : {}),
        count: result.logs.length,
        ...(savedTo ? { savedTo } : {}),
        logs: result.logs,
      });
    }
  );

  // ─── metro_network ─────────────────────────────────────────────────────────
  server.tool(
    "metro_network",
    "Captures network requests from a React Native app via the Metro CDP debugger (Network domain). " +
      "If webSocketDebuggerUrl is omitted, auto-discovers via metro_apps and uses the first connected app. " +
      "Pairs requestWillBeSent with responseReceived by requestId (method, url, status, headers, timing). " +
      "format:'har' emits a valid HAR 1.2 log (HAR-lite — no response bodies yet) you can open in Chrome " +
      "DevTools → Import HAR; pass saveTo to write the .har file. Sensitive headers (authorization/cookie/…) " +
      "are REDACTED by default — set redact:false to keep them (don't commit unredacted HAR: it leaks tokens).",
    {
      webSocketDebuggerUrl: z
        .string()
        .optional()
        .describe("CDP WebSocket URL from metro_apps. Omit to auto-discover."),
      port: z
        .number()
        .int()
        .min(1)
        .max(65535)
        .optional()
        .describe("Metro port for auto-discovery (default 8081)"),
      durationMs: z
        .number()
        .int()
        .min(100)
        .max(30000)
        .optional()
        .describe("How long to capture network activity in milliseconds (default 3000)"),
      maxEntries: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe("Maximum request entries to return (default 100, keeps most recent)"),
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
        .describe("Mask sensitive headers (authorization/cookie/set-cookie/…). Default true."),
    },
    async ({ webSocketDebuggerUrl, port, durationMs, maxEntries, format, saveTo, redact }) => {
      const disc = await resolveMetroWs(webSocketDebuggerUrl, port);
      if ("error" in disc) return errorResult(disc.error);
      const { wsUrl, chosenApp } = disc;

      const result = await readNetwork(wsUrl, { durationMs, maxEntries });
      if ("error" in result) {
        return errorResult(result.error);
      }

      if (format === "har") {
        const har = toHar(result.requests, { redact });
        const json = JSON.stringify(har, null, 2);
        let savedTo: string | undefined;
        if (saveTo) {
          try {
            await writeFile(saveTo, json, "utf8");
            savedTo = saveTo;
          } catch (e) {
            return errorResult(`metro_network: failed to write ${saveTo}: ${String(e)}`);
          }
        }
        return okResult({
          ...(chosenApp ? { chosenApp } : {}),
          format: "har",
          count: result.requests.length,
          redacted: redact !== false,
          ...(savedTo ? { savedTo } : {}),
          har,
        });
      }

      // Redaction-by-default applies to the JSON path too (not just HAR) so
      // tokens never leak regardless of output format.
      const entries = redactNetworkEntries(result.requests, { redact });
      let savedTo: string | undefined;
      if (saveTo) {
        try {
          await writeFile(saveTo, JSON.stringify(entries, null, 2), "utf8");
          savedTo = saveTo;
        } catch (e) {
          return errorResult(`metro_network: failed to write ${saveTo}: ${String(e)}`);
        }
      }
      return okResult({
        ...(chosenApp ? { chosenApp } : {}),
        count: entries.length,
        redacted: redact !== false,
        ...(savedTo ? { savedTo } : {}),
        requests: entries,
      });
    }
  );

  // ─── metro_state ─────────────────────────────────────────────────────────────
  server.tool(
    "metro_state",
    "Reads app state from a React Native app by evaluating a JS expression in its runtime via the " +
      "Metro CDP debugger (Runtime.evaluate, returnByValue). Default expression reads a globally-" +
      "exposed Redux store; override `expression` to read any in-app value. The app must expose the " +
      "value on a global the runtime can reach. Auto-discovers the ws via metro_apps when omitted.",
    {
      expression: z
        .string()
        .optional()
        .describe(
          "JS expression to evaluate (default: a globally-exposed Redux store's getState()). " +
            "e.g. \"store.getState().user\" or \"globalThis.__APP_STATE__\"."
        ),
      webSocketDebuggerUrl: z.string().optional().describe("CDP WebSocket URL from metro_apps. Omit to auto-discover."),
      port: z.number().int().min(1).max(65535).optional().describe("Metro port for auto-discovery (default 8081)"),
      timeoutMs: z.number().int().min(100).max(30000).optional().describe("Evaluation timeout in ms (default 5000)"),
    },
    async ({ expression, webSocketDebuggerUrl, port, timeoutMs }) => {
      const expr =
        expression ??
        "(typeof globalThis.store !== 'undefined' && globalThis.store.getState) ? globalThis.store.getState() : null";

      const disc = await resolveMetroWs(webSocketDebuggerUrl, port);
      if ("error" in disc) return errorResult(disc.error);
      const { wsUrl, chosenApp } = disc;

      const result = await evalRuntime(wsUrl, expr, { timeoutMs });
      if ("error" in result) return errorResult(result.error);
      return okResult({ ...(chosenApp ? { chosenApp } : {}), expression: expr, value: result.value });
    }
  );

  // ─── crash_list ──────────────────────────────────────────────────────────────
  server.tool(
    "crash_list",
    "Lists crash reports (.ips/.crash) from ~/Library/Logs/DiagnosticReports — plus the simulator's own container DiagnosticReports when udid is given — sorted newest first. Filter by processName (case-insensitive substring) and/or sinceHours.",
    {
      processName: z
        .string()
        .optional()
        .describe("Case-insensitive substring to filter by process name"),
      sinceHours: z
        .number()
        .positive()
        .optional()
        .describe("Only include crashes from the last N hours"),
      udid: z
        .string()
        .optional()
        .describe("Simulator UDID — also scans that sim's container DiagnosticReports"),
    },
    async ({ processName, sinceHours, udid }) => {
      const entries = await listCrashes({ processName, sinceHours, udid });
      return okResult({ count: entries.length, crashes: entries });
    }
  );

  // ─── crash_get ───────────────────────────────────────────────────────────────
  server.tool(
    "crash_get",
    "Reads a crash report by its id (filename from crash_list). For .ips files returns a parsed JSON header and the report body (first ~8000 chars, truncated flag set if longer). Pass the same udid used for crash_list to also resolve sim-container reports. Path-traversal-safe.",
    {
      id: z.string().describe("Crash report filename (id from crash_list)"),
      udid: z
        .string()
        .optional()
        .describe("Simulator UDID — also looks in that sim's container DiagnosticReports"),
    },
    async ({ id, udid }) => {
      const result = await getCrash(id, undefined, udid);
      if ("error" in result) {
        return errorResult(result.error);
      }
      return okResult(result);
    }
  );

  // ─── app_state ───────────────────────────────────────────────────────────────
  server.tool(
    "app_state",
    "Checks whether an app is installed and/or running on an iOS simulator. installed: exact " +
      "bundle-id match against the parsed simctl listapps output; running: matches the launchctl " +
      "UIKitApplication:<bundleId> label on a token boundary (no prefix false positives).",
    {
      udid: z.string().describe("Simulator UDID"),
      bundleId: z.string().describe("App bundle identifier (e.g. com.example.MyApp)"),
    },
    async ({ udid, bundleId }) => {
      const [appsResult, launchctlResult] = await Promise.all([
        listApps(udid),
        run("xcrun", ["simctl", "spawn", udid, "launchctl", "list"], { timeout: 10_000 }),
      ]);

      // Exact bundle-id equality — a substring check would report com.foo as
      // installed when only com.foobar exists.
      const installed = appsResult.ok && appsResult.apps.some((a) => a.bundleId === bundleId);

      // The launchctl label is UIKitApplication:<bundleId>[0x…]; anchor on the
      // closing '[' / whitespace / end so com.example.App does not match
      // com.example.AppExtension.
      const running =
        launchctlResult.code === 0 &&
        new RegExp(`UIKitApplication:${escapeRegExp(bundleId)}(?:\\[|\\s|$)`, "m").test(
          launchctlResult.stdout
        );

      return okResult({ udid, bundleId, installed, running });
    }
  );
}

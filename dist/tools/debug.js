import { z } from "zod";
import { run } from "../lib/exec.js";
import { listMetroApps, readConsoleLogs } from "../lib/metro.js";
import { listCrashes, getCrash } from "../lib/crash.js";
import { errorResult, okResult } from "../lib/result.js";
export function registerDebugTools(server) {
    // ─── metro_apps ──────────────────────────────────────────────────────────────
    server.tool("metro_apps", "Lists React Native apps currently connected to a Metro bundler inspector. Returns CDP-style targets (id, title, webSocketDebuggerUrl). Returns a structured error if Metro is not running on the given port.", {
        port: z
            .number()
            .int()
            .min(1)
            .max(65535)
            .optional()
            .describe("Metro dev server port (default 8081)"),
    }, async ({ port }) => {
        const result = await listMetroApps(port ?? 8081);
        if ("error" in result) {
            return errorResult(result.error);
        }
        return okResult(result);
    });
    // ─── metro_logs ──────────────────────────────────────────────────────────────
    server.tool("metro_logs", "Reads console logs from a React Native app via the Metro CDP debugger. If webSocketDebuggerUrl is omitted, auto-discovers via metro_apps and uses the first connected app. Reports which app was chosen.", {
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
    }, async ({ webSocketDebuggerUrl, port, durationMs, maxLogs }) => {
        let wsUrl = webSocketDebuggerUrl;
        let chosenApp;
        if (!wsUrl) {
            const apps = await listMetroApps(port ?? 8081);
            if ("error" in apps) {
                return errorResult(apps.error);
            }
            if (apps.length === 0) {
                return errorResult("metro_apps found no connected apps");
            }
            const first = apps[0];
            wsUrl = first.webSocketDebuggerUrl;
            chosenApp = first.title || first.description || first.id;
        }
        const result = await readConsoleLogs(wsUrl, { durationMs, maxLogs });
        if ("error" in result) {
            return errorResult(result.error);
        }
        return okResult({
            ...(chosenApp ? { chosenApp } : {}),
            count: result.logs.length,
            logs: result.logs,
        });
    });
    // ─── crash_list ──────────────────────────────────────────────────────────────
    server.tool("crash_list", "Lists crash reports (.ips/.crash) from ~/Library/Logs/DiagnosticReports — plus the simulator's own container DiagnosticReports when udid is given — sorted newest first. Filter by processName (case-insensitive substring) and/or sinceHours.", {
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
    }, async ({ processName, sinceHours, udid }) => {
        const entries = await listCrashes({ processName, sinceHours, udid });
        return okResult({ count: entries.length, crashes: entries });
    });
    // ─── crash_get ───────────────────────────────────────────────────────────────
    server.tool("crash_get", "Reads a crash report by its id (filename from crash_list). For .ips files returns a parsed JSON header and the report body (first ~8000 chars, truncated flag set if longer). Pass the same udid used for crash_list to also resolve sim-container reports. Path-traversal-safe.", {
        id: z.string().describe("Crash report filename (id from crash_list)"),
        udid: z
            .string()
            .optional()
            .describe("Simulator UDID — also looks in that sim's container DiagnosticReports"),
    }, async ({ id, udid }) => {
        const result = await getCrash(id, undefined, udid);
        if ("error" in result) {
            return errorResult(result.error);
        }
        return okResult(result);
    });
    // ─── app_state ───────────────────────────────────────────────────────────────
    server.tool("app_state", "Checks whether an app is installed and/or running on an iOS simulator. installed: checks xcrun simctl listapps output; running: checks launchctl list for UIKitApplication:<bundleId>.", {
        udid: z.string().describe("Simulator UDID"),
        bundleId: z.string().describe("App bundle identifier (e.g. com.example.MyApp)"),
    }, async ({ udid, bundleId }) => {
        const [listAppsResult, launchctlResult] = await Promise.all([
            run("xcrun", ["simctl", "listapps", udid], { timeout: 10_000 }),
            run("xcrun", ["simctl", "spawn", udid, "launchctl", "list"], { timeout: 10_000 }),
        ]);
        const installed = listAppsResult.code === 0 &&
            listAppsResult.stdout.toLowerCase().includes(bundleId.toLowerCase());
        const running = launchctlResult.code === 0 &&
            launchctlResult.stdout
                .toLowerCase()
                .includes(`UIKitApplication:${bundleId}`.toLowerCase());
        return okResult({ udid, bundleId, installed, running });
    });
}

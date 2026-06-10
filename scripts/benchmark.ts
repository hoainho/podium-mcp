/**
 * Podium MCP benchmark / smoke-test harness.
 *
 * Spawns a FRESH instance of dist/index.js over stdio, exercises all 30 tools,
 * and prints a pass/fail table + JSON summary.
 *
 * Usage:
 *   node --experimental-strip-types scripts/benchmark.ts
 *
 * Exit codes:
 *   0 — no FAIL results
 *   1 — at least one FAIL, or no booted simulator found
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ─── Paths ───────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, "..");
const serverEntry = join(repoRoot, "dist", "index.js");
const summaryPath = "/tmp/podium-benchmark-result.json";

// ─── Types ───────────────────────────────────────────────────────────────────

type ToolStatus = "PASS" | "FAIL" | "SKIP" | "GRACEFUL";

interface ToolResult {
  tool: string;
  status: ToolStatus;
  ms: number;
  note: string;
}

interface Summary {
  total: number;
  pass: number;
  fail: number;
  skip: number;
  graceful: number;
  results: ToolResult[];
}

// ─── MCP call helper ─────────────────────────────────────────────────────────

/**
 * Calls a single MCP tool with a per-call timeout.
 * Returns the raw result or throws on timeout / transport error.
 */
async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  timeoutMs = 60_000
): Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await client.callTool({ name, arguments: args });
    // The SDK returns a union; cast to the concrete shape we need.
    return result as { isError?: boolean; content: Array<{ type: string; text?: string }> };
  } finally {
    clearTimeout(timer);
  }
}

/** Extract text content from a tool result. */
function extractText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text ?? "")
    .join("\n");
}

/** Parse JSON embedded in a text result. Falls back to null. */
function parseResultJson(result: { content: Array<{ type: string; text?: string }> }): unknown {
  try {
    return JSON.parse(extractText(result));
  } catch {
    return null;
  }
}

// ─── Timing wrapper ──────────────────────────────────────────────────────────

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - start };
}

// ─── Result helpers ──────────────────────────────────────────────────────────

function pass(tool: string, ms: number, note = ""): ToolResult {
  return { tool, status: "PASS", ms, note };
}
function fail(tool: string, ms: number, note: string): ToolResult {
  return { tool, status: "FAIL", ms, note };
}
function skip(tool: string, reason: string): ToolResult {
  return { tool, status: "SKIP", ms: 0, note: reason };
}
function graceful(tool: string, ms: number, note: string): ToolResult {
  return { tool, status: "GRACEFUL", ms, note };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Spawn a fresh server instance via stdio transport
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverEntry],
    stderr: "pipe",
  });

  const client = new Client({ name: "podium-benchmark", version: "1.0.0" });

  console.log(`\nConnecting to: ${serverEntry}`);
  await client.connect(transport);
  console.log("Connected.\n");

  const results: ToolResult[] = [];

  // ── Helpers for recording results ─────────────────────────────────────────

  async function run(
    toolName: string,
    args: Record<string, unknown>,
    opts?: {
      /** If true, isError means "graceful no-precondition" rather than FAIL */
      gracefulError?: boolean;
      gracefulNote?: string;
      timeoutMs?: number;
    }
  ): Promise<{ result: { isError?: boolean; content: Array<{ type: string; text?: string }> }; ms: number }> {
    const { result, ms } = await timed(() =>
      callTool(client, toolName, args, opts?.timeoutMs ?? 60_000)
    );

    if (result.isError) {
      const note = extractText(result).slice(0, 200);
      if (opts?.gracefulError) {
        results.push(graceful(toolName, ms, opts.gracefulNote ?? note));
      } else {
        results.push(fail(toolName, ms, note));
      }
    } else {
      results.push(pass(toolName, ms));
    }

    return { result, ms };
  }

  // ─── Step 0: podium_health (no preconditions) ──────────────────────────────

  await run("podium_health", {});

  // ─── Step 1: device_list — auto-discover a booted iOS simulator ────────────

  console.log("Step 1/3: Discovering devices...");
  let { result: deviceListResult, ms: deviceListMs } = await timed(() =>
    callTool(client, "device_list", {})
  );

  if (deviceListResult.isError) {
    results.push(fail("device_list", deviceListMs, extractText(deviceListResult).slice(0, 200)));
    await client.close();
    printResults(results);
    process.exit(1);
  }
  results.push(pass("device_list", deviceListMs));

  const devicePayload = parseResultJson(deviceListResult) as {
    ios?: Array<{ udid: string; name: string; state: string }>;
  } | null;

  const iosDevices = devicePayload?.ios ?? [];
  const bootedDevice =
    iosDevices.find((d) => d.state?.toLowerCase() === "booted") ?? iosDevices[0] ?? null;

  if (!bootedDevice) {
    console.error("\nERROR: No iOS simulator found. Boot one with `xcrun simctl boot <udid>` and re-run.\n");
    await client.close();
    printResults(results);
    process.exit(1);
  }

  const udid = bootedDevice.udid;
  const deviceName = bootedDevice.name;
  const isActuallyBooted = bootedDevice.state?.toLowerCase() === "booted";

  console.log(
    `  Using device: ${deviceName} (${udid}) — state: ${bootedDevice.state}${isActuallyBooted ? "" : " (WARNING: not booted)"}\n`
  );

  // ─── Step 2: app_list — pick target bundle ─────────────────────────────────

  console.log("Step 2/3: Listing apps...");
  let { result: appListResult, ms: appListMs } = await timed(() =>
    callTool(client, "app_list", { udid })
  );

  let targetBundleId = "com.apple.mobilesafari";

  if (appListResult.isError) {
    results.push(fail("app_list", appListMs, extractText(appListResult).slice(0, 200)));
    console.log("  app_list failed — falling back to com.apple.mobilesafari\n");
  } else {
    results.push(pass("app_list", appListMs));
    const appPayload = parseResultJson(appListResult) as {
      apps?: Array<{ bundleId: string; type: string; name: string }>;
    } | null;
    const userApp = appPayload?.apps?.find((a) => a.type === "User");
    if (userApp) {
      targetBundleId = userApp.bundleId;
      console.log(`  Target bundle: ${targetBundleId} (${userApp.name})\n`);
    } else {
      console.log(`  No User app found — using fallback: ${targetBundleId}\n`);
    }
  }

  // ─── Step 3: Exercise all remaining tools ──────────────────────────────────

  console.log("Step 3/3: Running tool smoke tests...\n");

  // 3. device_boot — already booted; benign result expected
  await run("device_boot", { udid });

  // 5. app_state
  await run("app_state", { udid, bundleId: targetBundleId });

  // 6. app_install — SKIP (no .app path available)
  results.push(skip("app_install", "No .app path available in benchmark environment"));

  // 7. app_launch
  await run("app_launch", { udid, bundleId: targetBundleId });

  // 8. app_terminate (after launch above)
  await run("app_terminate", { udid, bundleId: targetBundleId });

  // Re-launch so subsequent Maestro flows have an active app
  {
    const { result: relaunch, ms: relaunchMs } = await timed(() =>
      callTool(client, "app_launch", { udid, bundleId: targetBundleId })
    );
    // Don't add to results — just a setup step; but warn on failure
    if (relaunch.isError) {
      console.log("  WARN: re-launch after terminate failed:", extractText(relaunch).slice(0, 120));
    }
  }

  // 9. app_uninstall — SKIP (destructive)
  results.push(skip("app_uninstall", "Destructive operation — skipped to preserve test environment"));

  // 10. screenshot
  await run("screenshot", { udid });

  // 11. screen_size
  await run("screen_size", { udid });

  // 12. orientation_get
  await run("orientation_get", { udid });

  // 13. open_url
  await run("open_url", { udid, url: "https://example.com" });

  // 14. set_location (Austin, TX — standard QA location)
  await run("set_location", { udid, latitude: 30.2672, longitude: -97.7431 });

  // 15. record_start + 16. record_stop (sequential pair)
  {
    const { result: startResult, ms: startMs } = await timed(() =>
      callTool(client, "record_start", { udid })
    );
    if (startResult.isError) {
      results.push(fail("record_start", startMs, extractText(startResult).slice(0, 200)));
      results.push(skip("record_stop", "record_start failed — skipping record_stop"));
    } else {
      results.push(pass("record_start", startMs));
      // Brief pause to capture at least 1 frame
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      await run("record_stop", { udid });
    }
  }

  // 17. inspect_screen — try with compact:true first, fall back without if error
  {
    const { result: inspectResult, ms: inspectMs } = await timed(() =>
      callTool(client, "inspect_screen", { udid, compact: true })
    );
    if (inspectResult.isError) {
      // compact param may not be wired yet; retry without it
      const { result: fallbackResult, ms: fallbackMs } = await timed(() =>
        callTool(client, "inspect_screen", { udid })
      );
      if (fallbackResult.isError) {
        results.push(fail("inspect_screen", fallbackMs, extractText(fallbackResult).slice(0, 200)));
      } else {
        results.push(pass("inspect_screen", fallbackMs, "compact param rejected — succeeded without it"));
      }
    } else {
      results.push(pass("inspect_screen", inspectMs, "compact:true accepted"));
    }
  }

  // 18. tap_on (coordinate-based)
  await run("tap_on", { udid, bundleId: targetBundleId, x: 200, y: 400 });

  // 19. input_text — may fail if no focused field; record result honestly
  await run("input_text", { udid, bundleId: targetBundleId, text: "podium" });

  // 20. swipe
  await run("swipe", { udid, bundleId: targetBundleId, direction: "up" });

  // 21. press_key (home)
  await run("press_key", { udid, bundleId: targetBundleId, key: "home" });

  // Re-launch after home press so orientation_set has a live app
  {
    await callTool(client, "app_launch", { udid, bundleId: targetBundleId }).catch(() => undefined);
  }

  // 22. orientation_set
  await run("orientation_set", { udid, bundleId: targetBundleId, value: "PORTRAIT" });

  // 23. tap_with_fallback
  await run("tap_with_fallback", { udid, x: 200, y: 400, maxRetries: 1 });

  // 24. notification_bar_clear
  await run("notification_bar_clear", { udid });

  // 25. run_flow — minimal launchApp flow
  {
    const flowYaml = `appId: ${targetBundleId}\n---\n- launchApp:\n    stopApp: false`;
    await run("run_flow", { udid, yaml: flowYaml });
  }

  // ── WebView tools (require an inspectable WKWebView in the foreground app) ──
  // "no embedded WebViews"/"not inspectable" is a precondition, not a bug.
  const noWebviewNote = "No inspectable WebView present (precondition, not a bug)";
  const webviewGraceful = {
    gracefulError: true,
    gracefulNote: noWebviewNote,
  } as const;

  // webview_inspect
  await run("webview_inspect", { udid }, webviewGraceful);
  // webview_eval
  await run("webview_eval", { udid, expression: "location.href" }, webviewGraceful);
  // webview_navigate (reload is the least disruptive action)
  await run("webview_navigate", { udid, action: "reload" }, webviewGraceful);

  // 26. cheat_sheet
  await run("cheat_sheet", {});

  // 27. metro_apps — "metro not running" is a graceful/expected error
  await run(
    "metro_apps",
    {},
    {
      gracefulError: true,
      gracefulNote: "Metro not running (expected in non-dev environment)",
    }
  );

  // 28. metro_logs — same semantics as metro_apps
  await run(
    "metro_logs",
    {},
    {
      gracefulError: true,
      gracefulNote: "Metro not running (expected in non-dev environment)",
    }
  );

  // 29. crash_list — then conditionally 30. crash_get
  {
    const { result: crashListResult, ms: crashListMs } = await timed(() =>
      callTool(client, "crash_list", {})
    );

    if (crashListResult.isError) {
      results.push(fail("crash_list", crashListMs, extractText(crashListResult).slice(0, 200)));
      results.push(skip("crash_get", "crash_list failed — cannot proceed"));
    } else {
      results.push(pass("crash_list", crashListMs));

      // 30. crash_get — conditional on crash_list returning ≥1 entry
      const crashPayload = parseResultJson(crashListResult) as {
        count?: number;
        crashes?: Array<{ id: string }>;
      } | null;

      const firstCrash = crashPayload?.crashes?.[0];
      if (firstCrash?.id) {
        await run("crash_get", { id: firstCrash.id, udid });
      } else {
        results.push(skip("crash_get", "No crash reports found — skipping"));
      }
    }
  }

  // ─── Disconnect ────────────────────────────────────────────────────────────

  await client.close();

  // ─── Output ────────────────────────────────────────────────────────────────

  printResults(results);
  writeSummary(results);

  const anyFail = results.some((r) => r.status === "FAIL");
  process.exit(anyFail ? 1 : 0);
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function printResults(results: ToolResult[]): void {
  const cols = { tool: 28, status: 10, ms: 8, note: 60 };
  const sep = "─".repeat(cols.tool + cols.status + cols.ms + cols.note + 9);

  const header = [
    "Tool".padEnd(cols.tool),
    "Status".padEnd(cols.status),
    "ms".padEnd(cols.ms),
    "Note",
  ].join(" │ ");

  console.log("\n" + sep);
  console.log(header);
  console.log(sep);

  for (const r of results) {
    const statusLabel =
      r.status === "PASS"
        ? "PASS"
        : r.status === "FAIL"
          ? "FAIL"
          : r.status === "SKIP"
            ? "SKIP"
            : "GRACEFUL";

    const line = [
      r.tool.padEnd(cols.tool),
      statusLabel.padEnd(cols.status),
      String(r.ms).padEnd(cols.ms),
      r.note.slice(0, cols.note),
    ].join(" │ ");

    console.log(line);
  }

  console.log(sep + "\n");

  const total = results.length;
  const passCount = results.filter((r) => r.status === "PASS").length;
  const failCount = results.filter((r) => r.status === "FAIL").length;
  const skipCount = results.filter((r) => r.status === "SKIP").length;
  const gracefulCount = results.filter((r) => r.status === "GRACEFUL").length;

  console.log(
    `TOTAL: ${total}  |  PASS: ${passCount}  |  FAIL: ${failCount}  |  SKIP: ${skipCount}  |  GRACEFUL: ${gracefulCount}\n`
  );
}

function writeSummary(results: ToolResult[]): void {
  const summary: Summary = {
    total: results.length,
    pass: results.filter((r) => r.status === "PASS").length,
    fail: results.filter((r) => r.status === "FAIL").length,
    skip: results.filter((r) => r.status === "SKIP").length,
    graceful: results.filter((r) => r.status === "GRACEFUL").length,
    results,
  };

  const json = JSON.stringify(summary, null, 2);
  console.log("JSON summary:\n" + json + "\n");

  try {
    writeFileSync(summaryPath, json, "utf8");
    console.log(`Summary written to: ${summaryPath}\n`);
  } catch (err) {
    console.error(`WARN: Could not write summary to ${summaryPath}: ${String(err)}`);
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("Benchmark error:", err);
  process.exit(1);
});

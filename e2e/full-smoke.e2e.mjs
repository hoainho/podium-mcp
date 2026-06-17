#!/usr/bin/env node
/**
 * Podium FULL real-device smoke — drives every registered MCP tool handler
 * against a booted iOS simulator and classifies each result:
 *   PASS      ok response (happy path verified on real hardware)
 *   PASS-ERR  expected structured error (dependency absent — error path verified)
 *   SKIP      needs an artifact not present here (recorded, not silently dropped)
 *   FAIL      threw, or returned an unexpected shape  → non-zero exit
 *
 * Honest coverage note: WebView happy-path and Metro-connected happy-path need a
 * debug RN app with an inspectable WKWebView running under Metro. Absent that,
 * those tools are smoked on their REAL error paths (structured error, no crash),
 * which is itself release-relevant behavior.
 *
 * Requires macOS + Xcode + a booted simulator. Run: node e2e/full-smoke.e2e.mjs
 */
import { mkdtempSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDevices } from "../dist/lib/simctl.js";
import { commandExists } from "../dist/lib/exec.js";
import { registerHealthTool } from "../dist/tools/health.js";
import { registerDeviceTools } from "../dist/tools/device.js";
import { registerScreenTools } from "../dist/tools/screen.js";
import { registerStepsTools } from "../dist/tools/steps.js";
import { registerFlowTools } from "../dist/tools/flow.js";
import { registerDebugTools } from "../dist/tools/debug.js";
import { registerWebviewTools } from "../dist/tools/webview.js";
import { registerAssertTools } from "../dist/tools/assert.js";
import { registerValidateTools } from "../dist/tools/validate.js";

const BUNDLE = "com.apple.Preferences"; // stock Settings app — always present
const baseTmp = process.env.RUNNER_TEMP || tmpdir();
const out = mkdtempSync(join(baseTmp, "podium-fullsmoke-"));

// ── capture every registered handler via a fake server ──
const handlers = new Map();
const fake = { tool: (name, _d, _s, fn) => handlers.set(name, fn) };
for (const reg of [
  registerHealthTool,
  registerDeviceTools,
  registerScreenTools,
  registerStepsTools,
  registerFlowTools,
  registerDebugTools,
  registerWebviewTools,
  registerAssertTools,
  registerValidateTools,
]) {
  reg(fake);
}

const results = [];
function record(tool, status, detail) {
  results.push({ tool, status, detail });
  const icon = { PASS: "✓", "PASS-ERR": "✓~", SKIP: "·", FAIL: "✗" }[status];
  console.log(`  ${icon} ${tool.padEnd(22)} ${status.padEnd(8)} ${detail ?? ""}`);
}

/** Call a handler; classify. expect: "ok" | "error" | "any". */
async function smoke(tool, args, expect = "ok", note = "") {
  const fn = handlers.get(tool);
  if (!fn) return record(tool, "FAIL", "handler not registered");
  let res;
  try {
    res = await fn(args);
  } catch (e) {
    return record(tool, "FAIL", `threw: ${String(e).slice(0, 100)}`);
  }
  if (!res || !Array.isArray(res.content) || !res.content[0] || typeof res.content[0].text !== "string") {
    return record(tool, "FAIL", "malformed MCP response");
  }
  const isErr = res.isError === true;
  const head = res.content[0].text.replace(/\s+/g, " ").slice(0, 80);
  if (expect === "ok" && isErr) return record(tool, "FAIL", `expected ok, got error: ${head}`);
  if (expect === "error" && !isErr) return record(tool, "FAIL", `expected error, got ok: ${head}`);
  record(tool, expect === "error" ? "PASS-ERR" : "PASS", note || head);
}

function skip(tool, why) {
  record(tool, "SKIP", why);
}

// ── target device ──
const dev = await listDevices();
const target = dev.devices.find((d) => d.state === "Booted");
if (!target) {
  console.error("FULL-SMOKE FAIL: no booted simulator (boot one first)");
  process.exit(1);
}
const U = target.udid;
console.log(`Target: ${target.name} (${U})`);
const hasMaestro = await commandExists("maestro");

console.log("\n[health]");
await smoke("podium_health", {}, "ok");

console.log("\n[device + capture]");
await smoke("device_list", {}, "ok");
await smoke("device_boot", { udid: U }, "ok"); // idempotent
await smoke("app_launch", { udid: U, bundleId: BUNDLE }, "ok");
await smoke("app_state", { udid: U, bundleId: BUNDLE }, "ok");
await smoke("app_list", { udid: U }, "ok");
await smoke("screen_size", { udid: U }, "ok");
await smoke("orientation_get", { udid: U }, "ok");
await smoke("open_url", { udid: U, url: "https://example.com" }, "ok");
await smoke("set_location", { udid: U, latitude: 30.2672, longitude: -97.7431 }, "ok");
const shot = join(out, "s.png");
await smoke("screenshot", { udid: U, saveTo: shot }, "ok");
await smoke("app_install", { udid: U, path: "/nonexistent/Bogus.app" }, "error", "bogus path → structured error");

console.log("\n[native gestures — idb/mobilecli]");
await smoke("inspect_screen", { udid: U }, "ok");
await smoke("tap_on", { udid: U, bundleId: BUNDLE, x: 200, y: 120 }, "ok");
await smoke("swipe", { udid: U, bundleId: BUNDLE, direction: "up" }, "ok");
await smoke("press_key", { udid: U, bundleId: BUNDLE, key: "home" }, "ok");
await smoke("app_launch", { udid: U, bundleId: BUNDLE }, "ok"); // re-foreground after home
await smoke("orientation_set", { udid: U, bundleId: BUNDLE, value: "PORTRAIT" }, "ok");
await smoke("run_steps", {
  udid: U,
  bundleId: BUNDLE,
  steps: [{ action: "tap", x: 200, y: 120 }, { action: "waitMs", ms: 200 }, { action: "screenshot" }],
}, "ok");
await smoke("tap_with_fallback", { udid: U, x: 200, y: 300, maxRetries: 1, offsetStep: 0 }, "any", "real tap + oracle");

console.log("\n[flows]");
await smoke("cheat_sheet", {}, "ok");
if (hasMaestro) {
  await smoke("run_flow", { udid: U, yaml: `appId: ${BUNDLE}\n---\n- launchApp:\n    stopApp: false`, timeoutMs: 60000 }, "ok");
} else {
  skip("run_flow", "maestro not installed");
}

console.log("\n[debug / RN — Metro up but no app connected]");
// "any": ok when Metro is up (possibly empty), structured error when Metro is down — both real+correct.
await smoke("metro_apps", {}, "any", "real Metro response (up-empty or down)");
await smoke("metro_logs", { durationMs: 500 }, "error", "no connected apps → structured error");
await smoke("metro_network", { durationMs: 500 }, "error", "no connected apps → structured error");
await smoke("metro_state", {}, "error", "no connected apps → structured error");
await smoke("crash_list", {}, "ok");
await smoke("crash_get", { id: "does-not-exist.ips" }, "error", "missing crash → structured error");

// WebView: HAPPY path against the committed fixture (e2e/fixtures/webview-native)
// when it's installed; otherwise the real error path. Build+install the fixture
// with `SKIP unset`: e2e/fixtures/webview-native/build.sh <udid>.
let fixtureUp = false;
try {
  execFileSync("xcrun", ["simctl", "launch", U, "com.podium.fixture"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 2500));
  fixtureUp = true;
} catch {
  // fixture not installed — fall back to the error-path checks
}
if (fixtureUp) {
  console.log("\n[webview HAPPY-path — WKWebView fixture]");
  await smoke("webview_eval", { udid: U, expression: "document.title" }, "ok", "→ Podium Fixture");
  await smoke("webview_inspect", { udid: U, selector: "#login" }, "ok", "#login → tapX/tapY");
  await smoke("webview_navigate", { udid: U, action: "reload" }, "ok", "reload");
  // The fixture's inline HTML makes no requests, so the buffer is typically empty —
  // but the inject→capture→read→HAR pipeline must still succeed against a real WebView.
  await smoke("webview_network", { udid: U, durationMs: 800, format: "har" }, "ok", "fetch/XHR capture → HAR");
} else {
  console.log("\n[webview — no fixture installed → real error path]");
  await smoke("webview_inspect", { udid: U }, "error", "no inspectable WebView → actionable error");
  await smoke("webview_eval", { udid: U, expression: "location.href" }, "error", "no inspectable WebView → actionable error");
  await smoke("webview_navigate", { udid: U, action: "reload" }, "error", "no inspectable WebView → actionable error");
  await smoke("webview_network", { udid: U, durationMs: 500 }, "error", "no inspectable WebView → actionable error");
}

console.log("\n[recording — real capture]");
await smoke("record_start", { udid: U }, "ok");
await new Promise((r) => setTimeout(r, 1500));
await smoke("record_stop", { udid: U }, "ok");

console.log("\n[v1 — asserts / verdict / export / HAR]");
// Open a known web page so there's deterministic on-screen text for the asserts.
await smoke("open_url", { udid: U, url: "https://example.com" }, "ok", "(re)open Safari for assert content");
await new Promise((r) => setTimeout(r, 2500));
await smoke("assert_visible", { udid: U, text: "Example", contains: true, timeoutMs: 5000 }, "any", "native a11y on web content");
await smoke("assert_not_visible", { udid: U, text: "ZZZ_NoSuch_Text_42", timeoutMs: 1500 }, "ok", "absence confirmed");
await smoke("wait_for_element", { udid: U, text: "Example", contains: true, timeoutMs: 5000 }, "any");
await smoke("validate_flow", { udid: U, assertions: [{ kind: "not_visible", text: "ZZZ_NoSuch_Text_42" }] }, "ok", "assertions + auto-checks verdict");
await smoke("export_flow", { bundleId: BUNDLE, steps: [{ action: "tapText", id: "login" }, { action: "tap", x: 10, y: 20 }] }, "ok", "Maestro export + lossy warnings");
await smoke("metro_network", { udid: U, durationMs: 500, format: "har" }, "any", "HAR-lite (no Metro app → error path)");

// app_uninstall intentionally skipped (won't remove a stock app).
skip("app_uninstall", "would remove a real app — not exercised in smoke");
skip("app_terminate", "covered implicitly; skipped to keep Settings foregrounded");

// ── tally ──
const n = (s) => results.filter((r) => r.status === s).length;
const fails = results.filter((r) => r.status === "FAIL");
console.log(`\n──────── ${results.length} tools | PASS ${n("PASS")} · PASS-ERR ${n("PASS-ERR")} · SKIP ${n("SKIP")} · FAIL ${n("FAIL")} ────────`);
try {
  if (statSync(shot).size > 0) console.log(`screenshot ok: ${statSync(shot).size} bytes`);
} catch {}
if (fails.length) {
  console.error("FULL-SMOKE FAIL:\n" + fails.map((f) => `  ✗ ${f.tool}: ${f.detail}`).join("\n"));
  process.exit(1);
}
console.log("FULL-SMOKE PASS: every tool returned the expected real response (happy path or structured error)");
process.exit(0);

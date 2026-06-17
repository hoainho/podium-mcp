#!/usr/bin/env node
/**
 * Podium smoke E2E — exercises the real toolchain against a booted iOS simulator
 * using only stock apps (no custom .app to ship). Drives the compiled dist
 * library the MCP tools sit on, so a regression in simctl/idb/Maestro plumbing
 * is caught end-to-end.
 *
 * Requires: macOS + Xcode + an available iOS simulator. Intended for CI
 * (macos runner) or local `node e2e/smoke.e2e.mjs`. NOT part of `npm test`.
 *
 * Exit 0 = pass; non-zero = fail (with a printed reason).
 */
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDevices, boot, screenshot, measureScreen, listApps } from "../dist/lib/simctl.js";

function fail(msg) {
  console.error(`E2E FAIL: ${msg}`);
  process.exit(1);
}
function step(msg) {
  console.log(`• ${msg}`);
}

// Honor RUNNER_TEMP on CI so the workflow's artifact glob (runner.temp) finds the PNG.
const baseTmp = process.env.RUNNER_TEMP || tmpdir();
const out = mkdtempSync(join(baseTmp, "podium-e2e-"));

// 1. Devices are enumerable.
step("listDevices");
const dev = await listDevices();
if (!dev.ok || dev.devices.length === 0) fail(`no simulators available: ${dev.error ?? "empty"}`);
const target = dev.devices.find((d) => d.state === "Booted") ?? dev.devices.find((d) => d.isAvailable);
if (!target) fail("no available simulator to target");
console.log(`  target: ${target.name} (${target.udid}) state=${target.state}`);

// 2. Boot is idempotent.
step("boot (idempotent)");
const b = await boot(target.udid);
const bootOk = b.ok || /current state: Booted|already booted/i.test(`${b.stderr} ${b.stdout}`);
if (!bootOk) fail(`boot failed (code ${b.code}): ${b.stderr || b.stdout}`);

// 2b. Wait for the display to actually come up (boot is async).
step("wait for Booted state");
const deadline = Date.now() + 90_000;
let booted = false;
while (Date.now() < deadline) {
  const cur = await listDevices();
  const d = cur.devices.find((x) => x.udid === target.udid);
  if (d && d.state === "Booted") {
    booted = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}
if (!booted) fail("device did not reach Booted state within 90s");

// 3. Screenshot produces a non-empty PNG.
step("screenshot");
const shot = join(out, "screen.png");
const s = await screenshot(target.udid, shot);
if (!s.ok) fail(`screenshot failed: ${s.stderr || s.stdout}`);
const size = statSync(shot).size;
if (!(size > 0)) fail("screenshot file is empty");
console.log(`  screenshot ${size} bytes → ${shot}`);

// 4. Screen size is measurable (exercises sips parsing).
step("screen_size");
const dims = await measureScreen(target.udid);
if (!dims.ok || !(dims.widthPx > 0) || !(dims.heightPx > 0)) fail(`measureScreen failed: ${dims.error ?? "bad dims"}`);
console.log(`  ${dims.widthPx}x${dims.heightPx}px`);

// 5. Installed apps are listable and include a stock app (plist→JSON path).
step("app_list");
const apps = await listApps(target.udid);
if (!apps.ok || apps.apps.length === 0) fail(`listApps failed: ${apps.error ?? "empty"}`);
const hasStock = apps.apps.some((a) => a.bundleId.startsWith("com.apple."));
if (!hasStock) fail("no com.apple.* stock app found in listApps output");
console.log(`  ${apps.apps.length} apps installed`);

console.log("E2E PASS: device control + capture + app-list verified on a real simulator");
process.exit(0);

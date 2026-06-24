#!/usr/bin/env node
/**
 * Podium Android smoke E2E (roadmap story A3) — exercises the real adb toolchain
 * against a booted Android emulator/device: enumerate → screen size → screenshot
 * → inspect (uiautomator) → tap. Drives the compiled dist library the MCP tools
 * sit on, so a regression in the adb plumbing is caught end-to-end.
 *
 * Requires: an Android emulator or device on `adb devices` (state "device").
 * Intended for an emulator-equipped CI runner (see .github/workflows/e2e-android.yml)
 * or local `node e2e/android-smoke.e2e.mjs`. NOT part of `npm test`.
 *
 * Exit 0 = pass; non-zero = fail (with a printed reason).
 */
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listAndroidTargets, androidDriver } from "../dist/lib/adb.js";
import { makeAdbBackend } from "../dist/lib/adb-backend.js";

function fail(msg) {
  console.error(`ANDROID E2E FAIL: ${msg}`);
  process.exit(1);
}
function step(msg) {
  console.log(`• ${msg}`);
}

const baseTmp = process.env.RUNNER_TEMP || tmpdir();
const out = mkdtempSync(join(baseTmp, "podium-android-e2e-"));

// 1. Devices enumerable via adb.
step("listAndroidTargets");
const targets = await listAndroidTargets();
if (targets.length === 0) fail("no Android emulator/device found on `adb devices`");
const target = targets[0];
console.log(`  target: ${target.name} (${target.udid})`);

// 2. Screen size (wm size parsing).
step("screenSize");
const dims = await androidDriver.screenSize(target.udid);
if (!dims || !(dims.widthPx > 0) || !(dims.heightPx > 0)) fail("could not read `wm size`");
console.log(`  ${dims.widthPx}x${dims.heightPx}px`);

// 3. Screenshot (screencap → pull) produces a non-empty PNG.
step("screenshot");
const shot = join(out, "android.png");
const ss = await androidDriver.screenshot(target.udid, shot);
if (!ss.ok) fail(`screenshot failed: ${ss.stderr || ss.stdout}`);
const size = statSync(shot).size;
if (!(size > 0)) fail("screenshot file is empty");
console.log(`  screenshot ${size} bytes → ${shot}`);

// 4. Inspect the view hierarchy (uiautomator dump → accessibility elements).
step("inspect (uiautomator dump)");
const backend = makeAdbBackend();
const els = await backend.describeAll(target.udid);
if (els === null) fail("uiautomator dump returned no hierarchy");
console.log(`  ${els.length} accessibility nodes`);

// 5. A center tap succeeds (input tap).
step("tap (input tap)");
const tap = await backend.tap(target.udid, Math.round(dims.widthPx / 2), Math.round(dims.heightPx / 2));
if (tap.code !== 0) fail(`tap failed: ${tap.stderr || tap.stdout}`);

console.log("ANDROID E2E PASS: enumerate + size + screenshot + inspect + tap verified on a real Android device");
process.exit(0);

#!/usr/bin/env node
/**
 * Podium game-engine smoke E2E (roadmap story C4) — verifies no-vision Unity/GL
 * automation against a LIVE AltTester-instrumented build: connect → engine_inspect
 * (named objects with screen coords, zero screenshots) → engine_tap.
 *
 * Requires an AltTester-instrumented build running on a reachable device with the
 * server forwarded to 127.0.0.1:13000. Because that build is not present in a
 * stock CI runner, this script SKIPS (exit 0) when no server is reachable, and
 * only asserts when one is — so it is safe to run anywhere but becomes a real
 * check once the instrumented sample (see e2e/fixtures/) is provided.
 *
 * Env: PODIUM_E2E_ENGINE_PORT (default 13000), PODIUM_E2E_ENGINE_OBJECT
 *      (an object name expected in the sample scene, default "PlayButton").
 *
 * Exit 0 = pass or skip; non-zero = a reachable server behaved incorrectly.
 */
import { EngineClient } from "../dist/lib/engine.js";
import { createEngineTransport } from "../dist/lib/engine-transport.js";

function fail(msg) {
  console.error(`ENGINE E2E FAIL: ${msg}`);
  process.exit(1);
}
function step(msg) {
  console.log(`• ${msg}`);
}
function skip(msg) {
  console.log(`ENGINE E2E SKIP: ${msg} (provide an AltTester-instrumented build to run this check)`);
  process.exit(0);
}

const port = Number(process.env.PODIUM_E2E_ENGINE_PORT) || 13000;
const objectName = process.env.PODIUM_E2E_ENGINE_OBJECT || "PlayButton";

step(`connect AltTester 127.0.0.1:${port}`);
let transport;
try {
  transport = await createEngineTransport("127.0.0.1", port, { connectTimeoutMs: 3000 });
} catch (e) {
  skip(`no AltTester server reachable (${e instanceof Error ? e.message : String(e)})`);
}

const client = new EngineClient(transport);
try {
  step(`engine_inspect by name="${objectName}" (no vision)`);
  const objs = await client.findObjects("name", objectName);
  if (objs.length === 0) fail(`no object named "${objectName}" in the scene`);
  const obj = objs[0];
  if (!Number.isFinite(obj.x) || !Number.isFinite(obj.y)) fail("object has no screen coordinates");
  console.log(`  ${obj.name} @ (${obj.x},${obj.y})`);

  step("engine_tap");
  await client.tap(obj);

  console.log("ENGINE E2E PASS: inspected + tapped a named engine object via AltTester, zero screenshots");
} finally {
  await client.close();
}
process.exit(0);

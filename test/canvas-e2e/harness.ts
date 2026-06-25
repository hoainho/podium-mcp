/**
 * Live canvas-bridge test harness (v0.4.0 Track 1).
 *
 * Drives the REAL `buildCanvasBridgeScript()` against REAL framework scene
 * graphs inside Playwright WebKit (≈ WKWebView) — the coverage the mocked unit
 * suite cannot provide. The flow per fixture:
 *
 *   1. open the fixture HTML (file://) — it defines `window.__setup` and, after
 *      setup, must set `window.__expectedClose = {x,y}` (the authoritative
 *      canvas-local CSS-px center of the "close" object: a known placement for
 *      2D, or the framework's OWN projection for 3D).
 *   2. inject the framework UMD build (defines the global the app exposes).
 *   3. run `__setup()` to build the scene + expose the root on window.
 *   4. inject `buildCanvasBridgeScript()` (installs `window.__podiumCanvas`).
 *   5. call `inspect()` and return the parsed objects + the fixture's expected.
 *
 * A fixture's expected coordinate is the ground truth; a test asserts the
 * bridge's reported center matches it within a small pixel tolerance, at
 * multiple devicePixelRatios.
 */
import { webkit, type Browser } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildCanvasBridgeScript, parseCanvasObjects } from "../../src/lib/canvas-adapters.js";
import type { CanvasObject } from "../../src/lib/canvas-types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");

/** UMD build path (relative to repo root) for each framework's global. */
export const FRAMEWORK_UMD = {
  konva: "node_modules/konva/konva.min.js",
  pixi: "node_modules/pixi.js/dist/pixi.min.js",
  fabric: "node_modules/fabric/dist/fabric.min.js",
  phaser: "node_modules/phaser/dist/phaser.min.js",
  three: "node_modules/three/build/three.min.js",
  babylon: "node_modules/babylonjs/babylon.js",
} as const;

export type FrameworkKey = keyof typeof FRAMEWORK_UMD;

export interface BridgeRun {
  framework: string;
  objects: CanvasObject[];
  expected: { x: number; y: number } | null;
}

export async function launchWebkit(): Promise<Browser> {
  return webkit.launch();
}

/** Find a reported object by exact name (the convention fixtures use for the
 *  target, e.g. "closeBtn"). */
export function byName(objects: CanvasObject[], name: string): CanvasObject | undefined {
  return objects.find((o) => o.name === name);
}

/**
 * Load a fixture, inject the framework + bridge, and return the bridge's
 * inspect() output (normalized) plus the fixture's authoritative expected
 * close-object center. `injectFramework:false` for fixtures that load their own
 * framework (e.g. a multi-canvas page) — then only the bridge is injected.
 */
export async function runFixture(
  browser: Browser,
  opts: {
    framework: FrameworkKey;
    fixture: string; // repo-relative path, e.g. test/canvas-e2e/fixtures/konva.html
    deviceScaleFactor: number;
    injectFramework?: boolean;
  }
): Promise<BridgeRun> {
  const page = await browser.newPage({
    deviceScaleFactor: opts.deviceScaleFactor,
    viewport: { width: 800, height: 600 },
  });
  try {
    await page.goto("file://" + resolve(REPO, opts.fixture));
    if (opts.injectFramework !== false) {
      await page.addScriptTag({ path: resolve(REPO, FRAMEWORK_UMD[opts.framework]) });
    }
    await page.evaluate(() => {
      const w = window as unknown as { __setup?: () => void };
      if (typeof w.__setup === "function") w.__setup();
    });
    await page.waitForTimeout(60); // let layout/raf settle
    await page.addScriptTag({ content: buildCanvasBridgeScript() });
    const raw = await page.evaluate(() => {
      const w = window as unknown as {
        __podiumCanvas: { inspect: () => { framework: string; objects: unknown[] } };
        __expectedClose?: { x: number; y: number };
      };
      const res = w.__podiumCanvas.inspect();
      return { framework: res.framework, objects: res.objects, expected: w.__expectedClose ?? null };
    });
    return { framework: raw.framework, objects: parseCanvasObjects(raw.objects), expected: raw.expected };
  } finally {
    await page.close();
  }
}

/** Assert a reported center is within `tol` CSS px of the expected point. */
export function within(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
  tol = 2
): boolean {
  return Math.abs(actual.x - expected.x) <= tol && Math.abs(actual.y - expected.y) <= tol;
}

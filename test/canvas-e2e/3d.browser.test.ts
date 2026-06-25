import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildCanvasBridgeScript } from "../../src/lib/canvas-adapters.js";
import { launchWebkit, runFixture, byName, within, FRAMEWORK_UMD, type FrameworkKey } from "./harness.js";

// 3D proof: the REAL bridge, against REAL Three.js and Babylon.js scenes, in
// WebKit (≈ WKWebView). Each fixture sets window.__expectedClose by mirroring
// the framework's OWN projection (world -> NDC/viewport -> CSS px), so the test
// asserts the bridge wires up getWorldPosition/project + NDC->px + viewport
// mapping + detection correctly — not a hand-typed magic coordinate.
//
// Tolerance is ±3 CSS px (slightly looser than the 2D ±2) to absorb projection
// float rounding. DPR 1 AND DPR 3 are both exercised: getBoundingClientRect()
// returns CSS px regardless of DPR, so the expected point is DPR-independent and
// the bridge must report the same px at 3x as at 1x.
const FIXTURES: Record<Extract<FrameworkKey, "three" | "babylon">, string> = {
  three: "test/canvas-e2e/fixtures/three.html",
  babylon: "test/canvas-e2e/fixtures/babylon.html",
};

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");

// hitTest probe: harness.runFixture only returns inspect() output, so to also
// exercise the bridge's hitTest(x,y) we replicate its injection sequence here
// (open fixture -> inject framework UMD -> __setup -> inject bridge) and then
// call window.__podiumCanvas.hitTest at the given canvas-local CSS point.
// Returns the hit object's name (or null), plus whether the reported 3D object
// carries a `bbox` — the field hitTest needs to register a hit.
async function hitTestProbe(
  browser: Browser,
  opts: { framework: FrameworkKey; fixture: string; deviceScaleFactor: number; at: { x: number; y: number } }
): Promise<{ hitName: string | null; targetHasBbox: boolean }> {
  const page = await browser.newPage({
    deviceScaleFactor: opts.deviceScaleFactor,
    viewport: { width: 800, height: 600 },
  });
  try {
    await page.goto("file://" + resolve(REPO, opts.fixture));
    await page.addScriptTag({ path: resolve(REPO, FRAMEWORK_UMD[opts.framework]) });
    await page.evaluate(() => {
      const w = window as unknown as { __setup?: () => void };
      if (typeof w.__setup === "function") w.__setup();
    });
    await page.waitForTimeout(60);
    await page.addScriptTag({ content: buildCanvasBridgeScript() });
    return await page.evaluate((at) => {
      const w = window as unknown as {
        __podiumCanvas: {
          hitTest: (x: number, y: number) => { name?: string } | null;
          inspect: () => { objects: Array<{ name?: string; bbox?: unknown }> };
        };
      };
      const hit = w.__podiumCanvas.hitTest(at.x, at.y);
      const target = w.__podiumCanvas.inspect().objects.find((o) => o.name === "closeBtn");
      return { hitName: hit ? String(hit.name ?? "") : null, targetHasBbox: !!(target && target.bbox) };
    }, opts.at);
  } finally {
    await page.close();
  }
}

describe("canvas bridge — Three.js + Babylon.js (live WebKit)", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchWebkit();
  });
  afterAll(async () => {
    await browser?.close();
  });

  for (const framework of ["three", "babylon"] as const) {
    for (const dpr of [1, 3]) {
      it(`detects ${framework} + locates closeBtn within ±3px @ DPR ${dpr}`, async () => {
        const run = await runFixture(browser, {
          framework,
          fixture: FIXTURES[framework],
          deviceScaleFactor: dpr,
        });
        expect(run.framework).toBe(framework);
        expect(
          run.expected,
          `${framework} fixture must set window.__expectedClose`
        ).toBeTruthy();

        const close = byName(run.objects, "closeBtn");
        expect(
          close,
          `closeBtn should be reported by the ${framework} bridge (got: ${run.objects
            .map((o) => o.name)
            .join(", ")})`
        ).toBeTruthy();

        expect(
          within({ x: close!.x, y: close!.y }, run.expected!, 3),
          `${framework} closeBtn @${dpr}x reported at (${close?.x}, ${close?.y}); expected ~(${run.expected?.x}, ${run.expected?.y})`
        ).toBe(true);
      });

      // hitTest(x,y) over the projected center. The bridge's hitTest matches on
      // each object's `bbox`; the 3D adapters (inspectThree/inspectBabylon) emit
      // only a projected center (x,y) and NO bbox, so a hit at the center cannot
      // register and hitTest returns null. This test pins that real contract and
      // is the canary for a future bridge change that gives 3D objects a bbox
      // (e.g. a synthetic box around the projected center / screen-space AABB).
      it(`hitTest at projected closeBtn center reflects 3D bbox contract @ DPR ${dpr} (${framework})`, async () => {
        const run = await runFixture(browser, {
          framework,
          fixture: FIXTURES[framework],
          deviceScaleFactor: dpr,
        });
        const center = run.expected!;
        const probe = await hitTestProbe(browser, {
          framework,
          fixture: FIXTURES[framework],
          deviceScaleFactor: dpr,
          at: center,
        });

        if (probe.targetHasBbox) {
          // If the bridge starts emitting a bbox for 3D objects, hitTest at the
          // projected center MUST resolve to closeBtn.
          expect(
            probe.hitName,
            `${framework} closeBtn now has a bbox; hitTest@(${center.x},${center.y}) should hit it but returned ${probe.hitName}`
          ).toBe("closeBtn");
        } else {
          // Current contract: no bbox on 3D objects => no hit at the center.
          expect(
            probe.hitName,
            `${framework} 3D objects carry no bbox, so hitTest@(${center.x},${center.y}) must be null; got ${probe.hitName}`
          ).toBeNull();
        }
      });
    }
  }
});

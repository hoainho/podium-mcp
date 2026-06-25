import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "playwright";
import { launchWebkit, runFixture, byName, within } from "./harness.js";
import type { FrameworkKey } from "./harness.js";

// Live bridge tests: REAL Pixi + Fabric scenes in WebKit, at DPR 1 and DPR 3.
// Asserts the close button is located within ±2 CSS px at each DPR —
// the DPR-3 case is the one mocked unit tests can never exercise.
describe("canvas bridge — Pixi + Fabric (live WebKit)", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchWebkit();
  });
  afterAll(async () => {
    await browser?.close();
  });

  for (const framework of ["pixi", "fabric"] as FrameworkKey[]) {
    for (const dpr of [1, 3]) {
      it(`detects ${framework} + locates closeBtn within ±2px @ DPR ${dpr}`, async () => {
        const run = await runFixture(browser, {
          framework,
          fixture: `test/canvas-e2e/fixtures/${framework}.html`,
          deviceScaleFactor: dpr,
        });
        expect(run.framework).toBe(framework);
        const close = byName(run.objects, "closeBtn");
        expect(close, "closeBtn should be reported by the bridge").toBeTruthy();
        expect(
          within({ x: close!.x, y: close!.y }, run.expected!, 2),
          `closeBtn @${dpr}x reported at (${close?.x}, ${close?.y}); expected ~(${run.expected?.x}, ${run.expected?.y})`
        ).toBe(true);
      });
    }
  }
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "playwright";
import { launchWebkit, runFixture, byName, within } from "./harness.js";

// Edge/robustness cases for the canvas bridge (v0.4.0 Track 1).
// Three independent sub-suites share a single Browser instance to keep
// launch overhead to one WebKit process.
describe("canvas bridge — edge & robustness (live WebKit)", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchWebkit();
  });
  afterAll(async () => {
    await browser?.close();
  });

  // -------------------------------------------------------------------
  // 1. Phaser — async scene boot, bridge detects window.game
  // -------------------------------------------------------------------
  describe("Phaser scene detection", () => {
    for (const dpr of [1, 3]) {
      it(`detects Phaser + locates closeBtn within ±2px @ DPR ${dpr}`, async () => {
        const run = await runFixture(browser, {
          framework: "phaser",
          fixture: "test/canvas-e2e/fixtures/phaser.html",
          deviceScaleFactor: dpr,
        });
        expect(run.framework).toBe("phaser");
        expect(run.expected).toEqual({ x: 760, y: 30 });
        const close = byName(run.objects, "closeBtn");
        expect(close, "closeBtn should be reported by the bridge").toBeTruthy();
        expect(
          within({ x: close!.x, y: close!.y }, run.expected!, 2),
          `closeBtn @${dpr}x reported at (${close?.x}, ${close?.y}); expected ~(760, 30)`
        ).toBe(true);
      });
    }
  });

  // -------------------------------------------------------------------
  // 2. Multi-canvas — bridge must pick the LARGEST canvas (800×600),
  //    ignoring the decoy 100×80 bare canvas.
  // -------------------------------------------------------------------
  describe("multi-canvas largest-canvas selection (Konva on 800×600)", () => {
    for (const dpr of [1, 3]) {
      it(`picks largest canvas + locates closeBtn within ±2px @ DPR ${dpr}`, async () => {
        const run = await runFixture(browser, {
          framework: "konva",
          fixture: "test/canvas-e2e/fixtures/multi-canvas.html",
          deviceScaleFactor: dpr,
        });
        expect(run.framework).toBe("konva");
        expect(run.expected).toEqual({ x: 760, y: 30 });
        const close = byName(run.objects, "closeBtn");
        expect(close, "closeBtn should be reported by the bridge").toBeTruthy();
        expect(
          within({ x: close!.x, y: close!.y }, run.expected!, 2),
          `closeBtn @${dpr}x reported at (${close?.x}, ${close?.y}); expected ~(760, 30)`
        ).toBe(true);
      });
    }
  });

  // -------------------------------------------------------------------
  // 3. Bare canvas — no framework, no window root → fail-closed.
  //    Bridge must return framework "unknown" and zero objects.
  // -------------------------------------------------------------------
  describe("bare canvas (no framework) — fail-closed", () => {
    it('returns framework "unknown" and zero objects', async () => {
      const run = await runFixture(browser, {
        framework: "konva", // framework key is unused — injectFramework:false
        fixture: "test/canvas-e2e/fixtures/bare.html",
        deviceScaleFactor: 1,
        injectFramework: false,
      });
      expect(run.framework).toBe("unknown");
      expect(run.objects.length).toBe(0);
    });
  });
});

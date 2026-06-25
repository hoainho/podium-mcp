import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Browser } from "playwright";
import { launchWebkit, runFixture, byName, within } from "./harness.js";

// Foundation proof: the REAL bridge, against a REAL Konva scene, in WebKit.
// Asserts the close button is located within ±2 CSS px at DPR 1 AND DPR 3 —
// the DPR-3 case is the one mocked unit tests can never exercise.
describe("canvas bridge — Konva (live WebKit)", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchWebkit();
  });
  afterAll(async () => {
    await browser?.close();
  });

  for (const dpr of [1, 3]) {
    it(`detects Konva + locates closeBtn within ±2px @ DPR ${dpr}`, async () => {
      const run = await runFixture(browser, {
        framework: "konva",
        fixture: "test/canvas-e2e/fixtures/konva.html",
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

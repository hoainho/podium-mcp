import { describe, it, expect, vi } from "vitest";
import { isVisionAllowed, visionInspect, type OcrFn } from "./canvas-vision.js";
import type { CanvasRect } from "./canvas-types.js";

// ---------------------------------------------------------------------------
// isVisionAllowed
// ---------------------------------------------------------------------------

describe("isVisionAllowed", () => {
  it("returns true only when PODIUM_ALLOW_VISION is exactly '1'", () => {
    expect(isVisionAllowed({ PODIUM_ALLOW_VISION: "1" })).toBe(true);
  });

  it("returns false when PODIUM_ALLOW_VISION is 'true'", () => {
    expect(isVisionAllowed({ PODIUM_ALLOW_VISION: "true" })).toBe(false);
  });

  it("returns false when PODIUM_ALLOW_VISION is 'yes'", () => {
    expect(isVisionAllowed({ PODIUM_ALLOW_VISION: "yes" })).toBe(false);
  });

  it("returns false when PODIUM_ALLOW_VISION is '0'", () => {
    expect(isVisionAllowed({ PODIUM_ALLOW_VISION: "0" })).toBe(false);
  });

  it("returns false when PODIUM_ALLOW_VISION is unset", () => {
    expect(isVisionAllowed({})).toBe(false);
  });

  it("returns false when PODIUM_ALLOW_VISION is undefined", () => {
    expect(isVisionAllowed({ PODIUM_ALLOW_VISION: undefined })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// visionInspect — allow:false gate
// ---------------------------------------------------------------------------

describe("visionInspect — disallowed (default-off)", () => {
  it("returns allowed:false, visionUsed:false, objects:[], tokenCost:0 when allow is false", async () => {
    const ocr = vi.fn<OcrFn>();
    const result = await visionInspect("/some/image.png", {
      ocr,
      allow: false,
      imageWH: { width: 1920, height: 1080 },
    });
    expect(result.allowed).toBe(false);
    expect(result.visionUsed).toBe(false);
    expect(result.objects).toEqual([]);
    expect(result.tokenCost).toBe(0);
  });

  it("does NOT call the OCR function when allow is false", async () => {
    const ocr = vi.fn<OcrFn>();
    await visionInspect("/some/image.png", {
      ocr,
      allow: false,
      imageWH: { width: 800, height: 600 },
    });
    expect(ocr).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// visionInspect — allow:true, successful OCR
// ---------------------------------------------------------------------------

describe("visionInspect — allowed, OCR succeeds", () => {
  const mockOcrItems: { text: string; bbox: CanvasRect }[] = [
    { text: "Play", bbox: { x: 100, y: 200, width: 80, height: 40 } },
    { text: "close", bbox: { x: 350, y: 10, width: 30, height: 30 } },
  ];

  it("returns visionUsed:true and 2 objects when OCR returns 2 items", async () => {
    const ocr = vi.fn<OcrFn>().mockResolvedValue(mockOcrItems);
    const result = await visionInspect("/frame.png", {
      ocr,
      allow: true,
      imageWH: { width: 400, height: 300 },
    });
    expect(result.visionUsed).toBe(true);
    expect(result.objects).toHaveLength(2);
  });

  it("sets source:'vision' on all returned objects", async () => {
    const ocr = vi.fn<OcrFn>().mockResolvedValue(mockOcrItems);
    const result = await visionInspect("/frame.png", {
      ocr,
      allow: true,
      imageWH: { width: 400, height: 300 },
    });
    for (const obj of result.objects) {
      expect(obj.source).toBe("vision");
    }
  });

  it("computes centre x/y from bbox", async () => {
    const ocr = vi.fn<OcrFn>().mockResolvedValue(mockOcrItems);
    const result = await visionInspect("/frame.png", {
      ocr,
      allow: true,
      imageWH: { width: 400, height: 300 },
    });
    // "Play": x=100,y=200,w=80,h=40 → cx=140,cy=220
    expect(result.objects[0].x).toBe(140);
    expect(result.objects[0].y).toBe(220);
    // "close": x=350,y=10,w=30,h=30 → cx=365,cy=25
    expect(result.objects[1].x).toBe(365);
    expect(result.objects[1].y).toBe(25);
  });

  it("infers role:'close' for text 'close'", async () => {
    const ocr = vi.fn<OcrFn>().mockResolvedValue(mockOcrItems);
    const result = await visionInspect("/frame.png", {
      ocr,
      allow: true,
      imageWH: { width: 400, height: 300 },
    });
    expect(result.objects[1].role).toBe("close");
  });

  it("returns tokenCost > 0 for a non-trivial image", async () => {
    const ocr = vi.fn<OcrFn>().mockResolvedValue(mockOcrItems);
    const result = await visionInspect("/frame.png", {
      ocr,
      allow: true,
      imageWH: { width: 400, height: 300 },
    });
    // 400*300/750 = 160 tokens
    expect(result.tokenCost).toBeGreaterThan(0);
    expect(result.tokenCost).toBe(Math.ceil((400 * 300) / 750));
  });

  it("sets allowed:true in the result", async () => {
    const ocr = vi.fn<OcrFn>().mockResolvedValue(mockOcrItems);
    const result = await visionInspect("/frame.png", {
      ocr,
      allow: true,
      imageWH: { width: 400, height: 300 },
    });
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// visionInspect — allow:true, OCR throws (fail-closed)
// ---------------------------------------------------------------------------

describe("visionInspect — allowed, OCR throws (fail-closed)", () => {
  it("does not throw when OCR rejects", async () => {
    const ocr = vi.fn<OcrFn>().mockRejectedValue(new Error("OCR service unavailable"));
    await expect(
      visionInspect("/broken.png", {
        ocr,
        allow: true,
        imageWH: { width: 1280, height: 720 },
      })
    ).resolves.not.toThrow();
  });

  it("returns allowed:true, visionUsed:false, objects:[], tokenCost:0 on OCR failure", async () => {
    const ocr = vi.fn<OcrFn>().mockRejectedValue(new Error("timeout"));
    const result = await visionInspect("/broken.png", {
      ocr,
      allow: true,
      imageWH: { width: 1280, height: 720 },
    });
    expect(result.allowed).toBe(true);
    expect(result.visionUsed).toBe(false);
    expect(result.objects).toEqual([]);
    expect(result.tokenCost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// visionInspect — OCR returns empty array
// ---------------------------------------------------------------------------

describe("visionInspect — allowed, OCR returns no items", () => {
  it("returns visionUsed:true with empty objects when OCR finds nothing", async () => {
    const ocr = vi.fn<OcrFn>().mockResolvedValue([]);
    const result = await visionInspect("/blank.png", {
      ocr,
      allow: true,
      imageWH: { width: 200, height: 200 },
    });
    expect(result.visionUsed).toBe(true);
    expect(result.objects).toEqual([]);
    expect(result.tokenCost).toBeGreaterThan(0);
  });
});

import { describe, it, expect } from "vitest";
import { parseCanvasObjects, buildCanvasBridgeScript, detectFrameworkExpression, } from "./canvas-adapters.js";
describe("parseCanvasObjects", () => {
    it("normalizes a Konva-shaped dump and stamps source=scene-graph", () => {
        const raw = [
            {
                name: "playBtn",
                id: 42,
                type: "Konva.Rect",
                text: "Play",
                x: 120,
                y: 240,
                bbox: { x: 100, y: 220, width: 40, height: 40 },
                visible: true,
                interactable: true,
                framework: "konva",
            },
        ];
        const expected = [
            {
                name: "playBtn",
                id: 42,
                type: "Konva.Rect",
                text: "Play",
                x: 120,
                y: 240,
                bbox: { x: 100, y: 220, width: 40, height: 40 },
                visible: true,
                interactable: true,
                framework: "konva",
                source: "scene-graph",
            },
        ];
        expect(parseCanvasObjects(raw)).toEqual(expected);
    });
    it("carries a string id (Pixi label) through unchanged", () => {
        expect(parseCanvasObjects([{ name: "spr", id: "hero", type: "PIXI.Sprite", x: 10, y: 20 }])).toEqual([
            { name: "spr", id: "hero", type: "PIXI.Sprite", x: 10, y: 20, source: "scene-graph" },
        ]);
    });
    it("drops objects without finite x AND y (untappable without vision)", () => {
        const raw = [
            { name: "noCoords", type: "Mesh" },
            { name: "halfCoords", x: 5 },
            { name: "ok", x: 1, y: 2 },
        ];
        expect(parseCanvasObjects(raw)).toEqual([{ name: "ok", x: 1, y: 2, source: "scene-graph" }]);
    });
    it("omits optional fields when absent so the shape compares exactly", () => {
        // No id/type/text/role/bbox/visible/interactable/framework => only x/y/name/source.
        expect(parseCanvasObjects([{ name: "bare", x: 3, y: 4 }])).toEqual([
            { name: "bare", x: 3, y: 4, source: "scene-graph" },
        ]);
    });
    it("drops a bbox that lacks finite width/height but keeps the object", () => {
        const out = parseCanvasObjects([{ name: "a", x: 1, y: 2, bbox: { x: 0, y: 0, width: "nope" } }]);
        expect(out).toEqual([{ name: "a", x: 1, y: 2, source: "scene-graph" }]);
        expect(out[0].bbox).toBeUndefined();
    });
    it("defaults a missing name to empty string (matches engine.parseEngineObjects)", () => {
        expect(parseCanvasObjects([{ x: 1, y: 2 }])).toEqual([{ name: "", x: 1, y: 2, source: "scene-graph" }]);
    });
    it("ignores an unknown framework token rather than mis-stamping it", () => {
        const out = parseCanvasObjects([{ name: "x", x: 1, y: 2, framework: "cocos" }]);
        expect(out[0].framework).toBeUndefined();
        expect(out).toEqual([{ name: "x", x: 1, y: 2, source: "scene-graph" }]);
    });
    it("accepts a JSON-string payload (bridge may double-encode)", () => {
        expect(parseCanvasObjects(JSON.stringify([{ name: "n", x: 7, y: 8, framework: "phaser" }]))).toEqual([{ name: "n", x: 7, y: 8, framework: "phaser", source: "scene-graph" }]);
    });
    it("returns [] on non-array, unparseable, or junk input", () => {
        expect(parseCanvasObjects("not json")).toEqual([]);
        expect(parseCanvasObjects(42)).toEqual([]);
        expect(parseCanvasObjects(null)).toEqual([]);
        expect(parseCanvasObjects({ name: "obj-not-array", x: 1, y: 2 })).toEqual([]);
        expect(parseCanvasObjects([null, 5, "x", { name: "kept", x: 1, y: 2 }])).toEqual([
            { name: "kept", x: 1, y: 2, source: "scene-graph" },
        ]);
    });
});
describe("buildCanvasBridgeScript", () => {
    it("returns a non-empty string that installs window.__podiumCanvas", () => {
        const src = buildCanvasBridgeScript();
        expect(typeof src).toBe("string");
        expect(src.length).toBeGreaterThan(0);
        expect(src).toContain("__podiumCanvas");
    });
    it("contains the per-framework detection tokens", () => {
        const src = buildCanvasBridgeScript();
        for (const token of ["__PIXI_APP__", "Konva", "Fabric", "Phaser", "game", "scene", "BABYLON"]) {
            expect(src).toContain(token);
        }
    });
    it("exposes the inspect/hitTest/objectRect surface", () => {
        const src = buildCanvasBridgeScript();
        expect(src).toContain("inspect");
        expect(src).toContain("hitTest");
        expect(src).toContain("objectRect");
    });
    it("parses as valid JS without throwing at definition time", () => {
        // new Function(...) compiles the source; a syntax error would throw here.
        // We do NOT call it (no browser globals), only assert it parses.
        expect(() => new Function(buildCanvasBridgeScript())).not.toThrow();
    });
    it("is JSON.stringify-safe (embeddable in an eval payload)", () => {
        const src = buildCanvasBridgeScript();
        expect(() => JSON.stringify(src)).not.toThrow();
        expect(JSON.parse(JSON.stringify(src))).toBe(src);
    });
});
describe("detectFrameworkExpression", () => {
    it("is a JS expression that reads the cached framework with an unknown fallback", () => {
        const expr = detectFrameworkExpression();
        expect(expr).toContain("__podiumCanvas");
        expect(expr).toContain("framework");
        expect(expr).toContain("unknown");
        // Must parse as an expression (wrap in a return so it's evaluated as one).
        expect(() => new Function("return (" + expr + ");")).not.toThrow();
    });
});

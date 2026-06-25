import { describe, it, expect } from "vitest";
import { parseA11yTree, buildA11ySnapshotScript } from "./canvas-a11y.js";
// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
/** Flutter flt-semantics-style nodes — role comes from the tag context. */
const fltSemanticsFixture = [
    {
        role: "button",
        label: "Play",
        text: "",
        rect: { x: 100, y: 200, width: 80, height: 40 },
    },
    {
        role: "image",
        label: "Hero banner",
        text: "",
        rect: { x: 0, y: 0, width: 400, height: 300 },
    },
];
/** ARIA-annotated DOM-style nodes — text content used when label absent. */
const ariaFixture = [
    {
        role: "button",
        label: "",
        text: "Submit",
        rect: { x: 50, y: 100, width: 120, height: 44 },
    },
    {
        role: "link",
        label: "Go home",
        text: "Home",
        rect: { x: 10, y: 500, width: 60, height: 20 },
    },
];
// ---------------------------------------------------------------------------
// parseA11yTree — flt-semantics fixture
// ---------------------------------------------------------------------------
describe("parseA11yTree — flt-semantics fixture", () => {
    it("returns correct CanvasObjects with source 'a11y'", () => {
        const objects = parseA11yTree(fltSemanticsFixture);
        expect(objects).toHaveLength(2);
        for (const obj of objects) {
            expect(obj.source).toBe("a11y");
            expect(obj.framework).toBe("a11y");
        }
    });
    it("maps role correctly from the node role field", () => {
        const objects = parseA11yTree(fltSemanticsFixture);
        expect(objects[0].role).toBe("button");
        expect(objects[1].role).toBe("image");
    });
    it("maps text from label when label is non-empty", () => {
        const objects = parseA11yTree(fltSemanticsFixture);
        expect(objects[0].text).toBe("Play");
        expect(objects[1].text).toBe("Hero banner");
    });
    it("computes centre x/y from rect", () => {
        const objects = parseA11yTree(fltSemanticsFixture);
        // node 0: x=100,y=200,w=80,h=40 → cx=140, cy=220
        expect(objects[0].x).toBe(140);
        expect(objects[0].y).toBe(220);
        // node 1: x=0,y=0,w=400,h=300 → cx=200, cy=150
        expect(objects[1].x).toBe(200);
        expect(objects[1].y).toBe(150);
    });
    it("sets bbox equal to the raw rect", () => {
        const objects = parseA11yTree(fltSemanticsFixture);
        expect(objects[0].bbox).toEqual({ x: 100, y: 200, width: 80, height: 40 });
        expect(objects[1].bbox).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    });
});
// ---------------------------------------------------------------------------
// parseA11yTree — ARIA fixture
// ---------------------------------------------------------------------------
describe("parseA11yTree — ARIA fixture", () => {
    it("returns correct CanvasObjects with source 'a11y'", () => {
        const objects = parseA11yTree(ariaFixture);
        expect(objects).toHaveLength(2);
        for (const obj of objects) {
            expect(obj.source).toBe("a11y");
        }
    });
    it("uses text content when label is empty", () => {
        const objects = parseA11yTree(ariaFixture);
        // node 0 has empty label → falls back to text "Submit"
        expect(objects[0].text).toBe("Submit");
    });
    it("prefers label over text when both present", () => {
        const objects = parseA11yTree(ariaFixture);
        // node 1 has label "Go home" and text "Home" → label wins
        expect(objects[1].text).toBe("Go home");
    });
    it("computes correct centre for ARIA nodes", () => {
        const objects = parseA11yTree(ariaFixture);
        // node 0: x=50,y=100,w=120,h=44 → cx=110, cy=122
        expect(objects[0].x).toBe(110);
        expect(objects[0].y).toBe(122);
    });
});
// ---------------------------------------------------------------------------
// parseA11yTree — node without rect is dropped
// ---------------------------------------------------------------------------
describe("parseA11yTree — rect filtering", () => {
    it("drops a node with missing rect", () => {
        const input = [
            { role: "button", label: "OK", text: "" }, // no rect
            { role: "button", label: "Cancel", text: "", rect: { x: 0, y: 0, width: 50, height: 30 } },
        ];
        const objects = parseA11yTree(input);
        expect(objects).toHaveLength(1);
        expect(objects[0].text).toBe("Cancel");
    });
    it("drops a node with non-finite rect values", () => {
        const input = [
            { role: "label", label: "Ghost", text: "", rect: { x: NaN, y: 0, width: 100, height: 20 } },
            { role: "label", label: "Real", text: "", rect: { x: 10, y: 10, width: 100, height: 20 } },
        ];
        const objects = parseA11yTree(input);
        expect(objects).toHaveLength(1);
        expect(objects[0].text).toBe("Real");
    });
    it("returns [] when all nodes lack a rect", () => {
        const input = [
            { role: "button", label: "A", text: "" },
            { role: "button", label: "B", text: "" },
        ];
        expect(parseA11yTree(input)).toEqual([]);
    });
});
// ---------------------------------------------------------------------------
// parseA11yTree — bad input
// ---------------------------------------------------------------------------
describe("parseA11yTree — bad input", () => {
    it("returns [] for null", () => {
        expect(parseA11yTree(null)).toEqual([]);
    });
    it("returns [] for a plain number", () => {
        expect(parseA11yTree(42)).toEqual([]);
    });
    it("returns [] for an unparseable string", () => {
        expect(parseA11yTree("not json at all")).toEqual([]);
    });
    it("returns [] for an empty object", () => {
        expect(parseA11yTree({})).toEqual([]);
    });
    it("accepts a valid JSON string and parses it", () => {
        const json = JSON.stringify([
            { role: "button", label: "OK", text: "", rect: { x: 0, y: 0, width: 60, height: 30 } },
        ]);
        const objects = parseA11yTree(json);
        expect(objects).toHaveLength(1);
        expect(objects[0].source).toBe("a11y");
    });
});
// ---------------------------------------------------------------------------
// buildA11ySnapshotScript
// ---------------------------------------------------------------------------
describe("buildA11ySnapshotScript", () => {
    it("returns a non-empty string", () => {
        const script = buildA11ySnapshotScript();
        expect(typeof script).toBe("string");
        expect(script.length).toBeGreaterThan(0);
    });
    it("mentions 'flt-semantics' to cover Flutter elements", () => {
        const script = buildA11ySnapshotScript();
        expect(script).toContain("flt-semantics");
    });
    it("mentions 'aria-label' to cover ARIA elements", () => {
        const script = buildA11ySnapshotScript();
        expect(script).toContain("aria-label");
    });
    it("includes getBoundingClientRect for geometry", () => {
        const script = buildA11ySnapshotScript();
        expect(script).toContain("getBoundingClientRect");
    });
});

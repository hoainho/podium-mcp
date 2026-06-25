import { describe, it, expect } from "vitest";
import { resolveIntent, scoreObject, INTENT_SYNONYMS } from "./canvas-resolver.js";
import { CANVAS_CONFIDENCE_THRESHOLD, CANVAS_AMBIGUITY_MARGIN, } from "./canvas-types.js";
/** Minimal CanvasObject factory — only the fields under test, sane defaults. */
function obj(over = {}) {
    return { name: "", x: 0, y: 0, ...over };
}
describe("resolveIntent — confident matches", () => {
    it('exact text "Close" (any case) → confidentEnough, with a text-match reason', () => {
        const objects = [
            obj({ name: "closeBtn", text: "Close", role: "button", interactable: true, x: 380, y: 20 }),
            obj({ name: "playBtn", text: "Play", role: "button", interactable: true, x: 200, y: 300 }),
        ];
        const r = resolveIntent(objects, "CLOSE");
        expect(r.confidentEnough).toBe(true);
        expect(r.best?.object.name).toBe("closeBtn");
        expect(r.best?.reasons.some((x) => /^text=/.test(x))).toBe(true);
        expect(r.best.score).toBeGreaterThanOrEqual(CANVAS_CONFIDENCE_THRESHOLD);
        // candidates are sorted desc by score
        expect(r.candidates[0]?.score).toBeGreaterThanOrEqual(r.candidates[1]?.score ?? 0);
    });
    it('icon-only "✕" resolves "close" via the synonym/icon table → confidentEnough', () => {
        const objects = [
            obj({ name: "iconClose", text: "✕", interactable: true, x: 360, y: 16 }),
            obj({ name: "title", text: "Welcome", interactable: false, x: 160, y: 40 }),
        ];
        const r = resolveIntent(objects, "close");
        expect(r.confidentEnough).toBe(true);
        expect(r.best?.object.name).toBe("iconClose");
        // matched through a synonym, not a literal "close"
        expect(r.best?.reasons.some((x) => x.includes("✕") || /text~/.test(x))).toBe(true);
    });
});
describe("resolveIntent — fail-closed on ambiguity", () => {
    it("TWO equally-named 'close' buttons → confidentEnough FALSE (within ambiguity margin)", () => {
        const a = obj({ name: "close", text: "Close", role: "button", interactable: true, x: 100, y: 100 });
        const b = obj({ name: "close", text: "Close", role: "button", interactable: true, x: 100, y: 100 });
        const r = resolveIntent([a, b], "close");
        expect(r.candidates).toHaveLength(2);
        // both are strong picks individually…
        expect(r.best.score).toBeGreaterThanOrEqual(CANVAS_CONFIDENCE_THRESHOLD);
        // …but indistinguishable, so we must not blind-tap
        expect(r.best.score - r.candidates[1].score).toBeLessThan(CANVAS_AMBIGUITY_MARGIN);
        expect(r.confidentEnough).toBe(false);
    });
    it("empty object list → best null, no candidates, not confident", () => {
        const r = resolveIntent([], "close");
        expect(r.best).toBeNull();
        expect(r.candidates).toEqual([]);
        expect(r.confidentEnough).toBe(false);
    });
    it("blank intent → confidently empty (never guesses)", () => {
        const r = resolveIntent([obj({ name: "close", text: "Close" })], "   ");
        expect(r.best).toBeNull();
        expect(r.candidates).toEqual([]);
        expect(r.confidentEnough).toBe(false);
    });
});
describe("resolveIntent — position heuristic", () => {
    it("two same-name candidates: the TOP-RIGHT one wins when a surface is given", () => {
        const surface = { x: 0, y: 0, width: 400, height: 400 };
        const topRight = obj({ name: "x", text: "Close", role: "button", interactable: true, x: 380, y: 20 });
        const bottomLeft = obj({ name: "x", text: "Close", role: "button", interactable: true, x: 20, y: 380 });
        // order them bottom-left-first to prove ranking is by score, not input order
        const r = resolveIntent([bottomLeft, topRight], "close", { surface });
        expect(r.best?.object).toBe(topRight);
        expect(r.best?.reasons).toContain("top-right corner");
        expect(r.best.score).toBeGreaterThan(r.candidates[1].score);
        // the position gap is enough to make the top-right pick unambiguous
        expect(r.confidentEnough).toBe(true);
    });
    it("with no surface and no positional separation, the same two stay ambiguous", () => {
        const topRight = obj({ name: "x", text: "Close", role: "button", interactable: true, x: 380, y: 20 });
        const alsoTopRight = obj({ name: "x", text: "Close", role: "button", interactable: true, x: 380, y: 20 });
        const r = resolveIntent([topRight, alsoTopRight], "close");
        expect(r.confidentEnough).toBe(false);
    });
});
describe("scoreObject — evidence + interactable boost", () => {
    it("every scored candidate carries a non-empty reasons[]", () => {
        const objects = [
            obj({ name: "ok", text: "OK", role: "button", interactable: true }),
            obj({ name: "settingsGear", text: "⚙", role: "button", interactable: true }),
        ];
        const r = resolveIntent(objects, "ok");
        expect(r.candidates.length).toBeGreaterThan(0);
        for (const c of r.candidates) {
            expect(c.reasons.length).toBeGreaterThan(0);
        }
    });
    it("an interactable object scores strictly higher than an identical non-interactable one", () => {
        const interactable = obj({ name: "close", text: "Close", interactable: true });
        const inert = obj({ name: "close", text: "Close", interactable: false });
        const hot = scoreObject(interactable, "close");
        const cold = scoreObject(inert, "close");
        expect(hot.score).toBeGreaterThan(cold.score);
        expect(hot.reasons).toContain("interactable");
        expect(cold.reasons).not.toContain("interactable");
    });
    it("a totally unrelated object scores 0 with no reasons (not a candidate)", () => {
        const { score, reasons } = scoreObject(obj({ name: "avatar", text: "Profile", role: "image" }), "close");
        expect(score).toBe(0);
        expect(reasons).toEqual([]);
    });
    it("role match alone contributes evidence even without a text label", () => {
        const { score, reasons } = scoreObject(obj({ name: "n1", role: "close", interactable: true }), "close");
        expect(score).toBeGreaterThan(0);
        expect(reasons.some((x) => /^role=/.test(x))).toBe(true);
    });
});
describe("INTENT_SYNONYMS", () => {
    it("close maps the core glyphs and verbs the resolver relies on", () => {
        for (const token of ["close", "dismiss", "x", "✕", "cancel", "exit", "back"]) {
            expect(INTENT_SYNONYMS.close).toContain(token);
        }
    });
    it("ships the other documented intents", () => {
        for (const key of ["ok", "confirm", "continue", "play", "settings", "menu", "next", "back"]) {
            expect(INTENT_SYNONYMS[key]?.length ?? 0).toBeGreaterThan(0);
        }
    });
});

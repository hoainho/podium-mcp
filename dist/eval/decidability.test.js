import { describe, it, expect, vi, beforeEach } from "vitest";
import * as nativeLib from "../lib/native.js";
import * as gestureLib from "../lib/gesture.js";
import * as simctlLib from "../lib/simctl.js";
import { evaluateDecidability } from "./decidability.js";
// ── checker unit tests ────────────────────────────────────────────────────
describe("evaluateDecidability — invariant checker", () => {
    it("ok success is decidable", () => {
        expect(evaluateDecidability({ content: [], structuredContent: { status: "ok" } }).decidable).toBe(true);
    });
    it("a result without structuredContent is NOT decidable (model must read prose)", () => {
        expect(evaluateDecidability({ content: [{ type: "text", text: "{}" }] }).decidable).toBe(false);
    });
    it("a hard error needs remediation/suggestedTool/candidates", () => {
        expect(evaluateDecidability({ isError: true, content: [], structuredContent: { status: "failed", error: { code: "failed", message: "x" } } }).decidable).toBe(false);
        expect(evaluateDecidability({ isError: true, content: [], structuredContent: { status: "failed", error: { code: "failed", message: "x", remediation: "do y" } } }).decidable).toBe(true);
    });
    it("a soft-fail (non-ok status via okResult) needs next[]", () => {
        expect(evaluateDecidability({ content: [], structuredContent: { status: "failed", ok: false } }).decidable).toBe(false);
        expect(evaluateDecidability({ content: [], structuredContent: { status: "failed", next: ["fix it"] } }).decidable).toBe(true);
    });
});
// ── canonical-flow decision points through REAL handlers ────────────────────
function makeFakeServer() {
    const handlers = new Map();
    return { handlers, tool(n, _d, _s, h) { handlers.set(n, h); } };
}
async function screenHandlers() {
    const { registerScreenTools } = await import("../tools/screen.js");
    const f = makeFakeServer();
    registerScreenTools(f);
    return f.handlers;
}
async function stepsHandlers() {
    const { registerStepsTools } = await import("../tools/steps.js");
    const f = makeFakeServer();
    registerStepsTools(f);
    return f.handlers;
}
const OK = { code: 0, stdout: "", stderr: "" };
const elFrame = (y) => ({ label: "Login", frame: { x: 0, y, width: 10, height: 10 } });
describe("model-agnostic decidability — every canonical decision point is decidable (G006)", () => {
    beforeEach(() => vi.restoreAllMocks());
    it("Flow A: tap_on on an AMBIGUOUS target is decidable (ambiguous + candidates)", async () => {
        vi.spyOn(nativeLib, "getBackend").mockResolvedValue({ name: "idb", describeAll: vi.fn(async () => [elFrame(0), elFrame(100)]), tap: vi.fn(async () => OK) });
        const res = await (await screenHandlers()).get("tap_on")({ udid: "U", bundleId: "c", text: "Login" });
        const d = evaluateDecidability(res);
        expect(d).toMatchObject({ decidable: true, status: "ambiguous" });
    });
    it("Flow A: tap_on SUCCESS is decidable (ok + verify next)", async () => {
        vi.spyOn(nativeLib, "getBackend").mockResolvedValue({ name: "idb", describeAll: vi.fn(async () => [elFrame(0)]), tap: vi.fn(async () => OK) });
        const res = await (await screenHandlers()).get("tap_on")({ udid: "U", bundleId: "c", text: "Login" });
        expect(evaluateDecidability(res)).toMatchObject({ decidable: true, status: "ok" });
    });
    it("Flow B: input_text SUCCESS is decidable (ok + WebView-caveat next)", async () => {
        vi.spyOn(gestureLib, "nativeInputText").mockResolvedValue({ ok: true, backend: "idb", submit: false });
        const res = await (await screenHandlers()).get("input_text")({ udid: "U", bundleId: "c", text: "hi" });
        expect(evaluateDecidability(res)).toMatchObject({ decidable: true, status: "ok" });
    });
    it("Flow B: input_text FAILURE is decidable (failed + suggestedTool)", async () => {
        vi.spyOn(gestureLib, "nativeInputText").mockResolvedValue({ ok: false, backend: "idb", detail: "no focus" });
        const res = await (await screenHandlers()).get("input_text")({ udid: "U", bundleId: "c", text: "hi" });
        expect(evaluateDecidability(res)).toMatchObject({ decidable: true, status: "failed" });
    });
    it("Orchestrator: run_steps BATCH FAILURE is decidable (failed + next), not a false ok", async () => {
        vi.spyOn(nativeLib, "getBackend").mockResolvedValue({ name: "idb", describeAll: vi.fn(async () => [elFrame(0)]), tap: vi.fn(async () => OK), screenPoints: vi.fn(async () => ({ w: 402, h: 874 })) });
        vi.spyOn(gestureLib, "nativeTap").mockResolvedValue({ ok: false, backend: "maestro", detail: "no backend" });
        const res = await (await stepsHandlers()).get("run_steps")({ udid: "U", steps: [{ action: "tap", x: 1, y: 2 }] });
        expect(evaluateDecidability(res)).toMatchObject({ decidable: true, status: "failed" });
    });
    it("Orchestrator: run_steps all-ok is decidable (ok)", async () => {
        vi.spyOn(nativeLib, "getBackend").mockResolvedValue({ name: "idb", describeAll: vi.fn(async () => [elFrame(0)]), tap: vi.fn(async () => OK), screenPoints: vi.fn(async () => ({ w: 402, h: 874 })) });
        vi.spyOn(gestureLib, "nativeTap").mockResolvedValue({ ok: true, backend: "mobilecli", detail: "tapped" });
        vi.spyOn(simctlLib, "screenshot").mockResolvedValue({ ok: true, code: 0, stdout: "", stderr: "" });
        const res = await (await stepsHandlers()).get("run_steps")({ udid: "U", steps: [{ action: "tap", x: 1, y: 2 }] });
        expect(evaluateDecidability(res)).toMatchObject({ decidable: true, status: "ok" });
    });
});

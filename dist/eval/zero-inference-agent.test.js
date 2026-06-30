import { describe, it, expect, vi, beforeEach } from "vitest";
import * as nativeLib from "../lib/native.js";
async function zeroInferenceTap(handler, base) {
    const log = [];
    let args = { ...base };
    for (let step = 0; step < 3; step++) {
        const res = await handler(args);
        const sc = (res.structuredContent ?? {});
        log.push({ args, status: sc.status });
        if (!res.isError && sc.status === "ok")
            return { ok: true, steps: step + 1, log };
        if (res.isError && sc.status === "ambiguous") {
            const cands = sc.error?.candidates ?? [];
            if (cands.length === 0)
                return { ok: false, reason: "ambiguous w/o candidates", log };
            args = { ...base, index: cands[0].index }; // fixed rule: take first candidate's index
            continue;
        }
        return { ok: false, reason: `unhandled status ${sc.status}`, log };
    }
    return { ok: false, reason: "exceeded steps", log };
}
async function tapHandler() {
    const { registerScreenTools } = await import("../tools/screen.js");
    const handlers = new Map();
    const fake = { tool(n, _d, _s, h) { handlers.set(n, h); } };
    registerScreenTools(fake);
    return handlers.get("tap_on");
}
const OK = { code: 0, stdout: "", stderr: "" };
const el = (y) => ({ label: "Login", frame: { x: 0, y, width: 10, height: 10 } });
describe("zero-inference agent completes Flow A purely from the envelope (G006 empirical floor)", () => {
    beforeEach(() => vi.restoreAllMocks());
    it("recovers from an AMBIGUOUS tap and succeeds in 2 steps — no UI reasoning", async () => {
        vi.spyOn(nativeLib, "getBackend").mockResolvedValue({
            name: "idb",
            describeAll: vi.fn(async () => [el(0), el(100)]), // 2 matches -> ambiguous on step 1
            tap: vi.fn(async () => OK),
        });
        const handler = await tapHandler();
        const out = await zeroInferenceTap(handler, { udid: "U", bundleId: "c", text: "Login" });
        expect(out.ok).toBe(true);
        expect(out.steps).toBe(2);
        expect(out.log[0].status).toBe("ambiguous"); // step 1 fails closed
        expect(out.log[1].args.index).toBe(0); // step 2 driven SOLELY by candidates
        expect(out.log[1].status).toBe("ok");
    });
    it("a single unambiguous match succeeds in 1 step", async () => {
        vi.spyOn(nativeLib, "getBackend").mockResolvedValue({
            name: "idb",
            describeAll: vi.fn(async () => [el(0)]),
            tap: vi.fn(async () => OK),
        });
        const handler = await tapHandler();
        const out = await zeroInferenceTap(handler, { udid: "U", bundleId: "c", text: "Login" });
        expect(out).toMatchObject({ ok: true, steps: 1 });
    });
});

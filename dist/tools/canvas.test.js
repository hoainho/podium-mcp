import { describe, it, expect, vi, afterEach } from "vitest";
import * as webview from "../lib/webview.js";
import * as gesture from "../lib/gesture.js";
import { registerCanvasTools } from "./canvas.js";
function fakeServer() {
    const handlers = new Map();
    const tool = (name, _d, _s, handler) => {
        handlers.set(name, handler);
    };
    return { server: { tool }, handlers };
}
function payload(res) {
    if (res.isError)
        return { __error: res.content[0].text };
    return JSON.parse(res.content[0].text);
}
const WV = {
    id: "wv-1",
    url: "https://game.example",
    title: "Game",
    bounds: { x: 0, y: 64, width: 390, height: 700 },
    isVisible: true,
};
function bridgeDump(objects, framework = "pixi", canvasLeft = 0, canvasTop = 0) {
    return JSON.stringify({ framework, objects, canvasLeft, canvasTop });
}
function setup() {
    const { server, handlers } = fakeServer();
    registerCanvasTools(server);
    return handlers;
}
describe("canvas tools", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        delete process.env.PODIUM_DISABLE_WEBVIEW_EVAL;
    });
    it("canvas_inspect lists parsed scene-graph objects with the framework", async () => {
        vi.spyOn(webview, "resolveWebview").mockResolvedValue({ ok: true, data: WV });
        vi.spyOn(webview, "evalWebview").mockResolvedValue({
            ok: true,
            data: bridgeDump([
                { name: "closeBtn", type: "PIXI.Sprite", x: 100, y: 50, text: "Close", bbox: { x: 90, y: 40, width: 20, height: 20 } },
            ]),
        });
        const out = payload(await setup().get("canvas_inspect")({ udid: "U" }));
        expect(out.framework).toBe("pixi");
        expect(out.count).toBe(1);
        expect(out.objects[0]).toMatchObject({
            name: "closeBtn",
            source: "scene-graph",
            x: 100,
            y: 50,
            text: "Close",
        });
    });
    it("canvas_inspect on a bare canvas returns an actionable hint", async () => {
        vi.spyOn(webview, "resolveWebview").mockResolvedValue({ ok: true, data: WV });
        vi.spyOn(webview, "evalWebview").mockResolvedValue({ ok: true, data: bridgeDump([], "unknown") });
        const out = payload(await setup().get("canvas_inspect")({ udid: "U" }));
        expect(out.count).toBe(0);
        expect(String(out.hint)).toMatch(/no canvas framework/i);
    });
    it("canvas_resolve ranks a close target with evidence and a fail-closed flag", async () => {
        vi.spyOn(webview, "resolveWebview").mockResolvedValue({ ok: true, data: WV });
        vi.spyOn(webview, "evalWebview").mockResolvedValue({
            ok: true,
            data: bridgeDump([
                { name: "closeBtn", x: 360, y: 20, text: "Close", interactable: true, bbox: { x: 350, y: 10, width: 20, height: 20 } },
                { name: "bg", x: 195, y: 350, text: "", bbox: { x: 0, y: 0, width: 390, height: 700 } },
            ]),
        });
        const out = payload(await setup().get("canvas_resolve")({ udid: "U", intent: "close" }));
        expect(out.confidentEnough).toBe(true);
        const best = out.best;
        expect(best.object.name).toBe("closeBtn");
        expect(best.reasons.length).toBeGreaterThan(0);
    });
    it("canvas_tap taps the confident match at absolute screen coordinates", async () => {
        vi.spyOn(webview, "resolveWebview").mockResolvedValue({ ok: true, data: WV });
        vi.spyOn(webview, "evalWebview").mockResolvedValue({
            ok: true,
            data: bridgeDump([{ name: "closeBtn", x: 360, y: 20, text: "Close", interactable: true, bbox: { x: 350, y: 10, width: 20, height: 20 } }], "pixi", 5, 100),
        });
        const tapSpy = vi.spyOn(gesture, "nativeTap").mockResolvedValue({ ok: true, backend: "idb", detail: "tapped" });
        const out = payload(await setup().get("canvas_tap")({ udid: "U", intent: "close" }));
        expect(out.ok).toBe(true);
        // origin = bounds(0,64) + canvas offset(5,100); + object center(360,20)
        expect(tapSpy).toHaveBeenCalledWith("U", 365, 184, undefined);
        expect(out.screenX).toBe(365);
        expect(out.screenY).toBe(184);
    });
    it("canvas_tap fails closed (does NOT tap) when the match is ambiguous", async () => {
        vi.spyOn(webview, "resolveWebview").mockResolvedValue({ ok: true, data: WV });
        vi.spyOn(webview, "evalWebview").mockResolvedValue({
            ok: true,
            data: bridgeDump([
                { name: "a", x: 10, y: 10, text: "Close", interactable: true },
                { name: "b", x: 20, y: 20, text: "Close", interactable: true },
            ]),
        });
        const tapSpy = vi.spyOn(gesture, "nativeTap").mockResolvedValue({ ok: true, backend: "idb", detail: "" });
        const res = await setup().get("canvas_tap")({ udid: "U", intent: "close" });
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toMatch(/not tapping|fail-closed/i);
        expect(tapSpy).not.toHaveBeenCalled();
    });
    it("canvas tools respect the eval lockdown", async () => {
        process.env.PODIUM_DISABLE_WEBVIEW_EVAL = "1";
        const res = await setup().get("canvas_inspect")({ udid: "U" });
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toMatch(/disabled/i);
    });
    it("surfaces a resolveWebview failure as an actionable error", async () => {
        vi.spyOn(webview, "resolveWebview").mockResolvedValue({ ok: false, error: "no inspectable WebView found" });
        const res = await setup().get("canvas_inspect")({ udid: "U" });
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toMatch(/no inspectable WebView/);
    });
});

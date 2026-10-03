import { describe, it, expect, vi, afterEach } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as webview from "../lib/webview.js";
import type { Webview } from "../lib/webview.js";
import * as gesture from "../lib/gesture.js";
import { registerCanvasTools } from "./canvas.js";

interface ToolRes {
  content: { type: string; text: string }[];
  isError?: boolean;
}
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolRes>;

function fakeServer(): { server: McpServer; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>();
  const tool = (name: string, _d: string, _s: unknown, handler: ToolHandler): void => {
    handlers.set(name, handler);
  };
  return { server: { tool } as unknown as McpServer, handlers };
}

function payload(res: ToolRes): Record<string, unknown> {
  if (res.isError) return { __error: res.content[0].text };
  return JSON.parse(res.content[0].text) as Record<string, unknown>;
}

const WV: Webview = {
  id: "wv-1",
  url: "https://game.example",
  title: "Game",
  bounds: { x: 0, y: 64, width: 390, height: 700 },
  isVisible: true,
};

function bridgeDump(objects: unknown[], framework = "pixi", canvasLeft = 0, canvasTop = 0): string {
  return queryDump({ framework, objects }, framework, canvasLeft, canvasTop);
}

function queryDump(value: unknown, framework = "pixi", canvasLeft = 0, canvasTop = 0): string {
  return JSON.stringify({ framework, value, canvasLeft, canvasTop });
}

function setup(): Map<string, ToolHandler> {
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
    const out = payload(await setup().get("canvas_inspect")!({ udid: "U" }));
    expect(out.framework).toBe("pixi");
    expect(out.count).toBe(1);
    expect((out.objects as Record<string, unknown>[])[0]).toMatchObject({
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
    const out = payload(await setup().get("canvas_inspect")!({ udid: "U" }));
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
    const out = payload(await setup().get("canvas_resolve")!({ udid: "U", intent: "close" }));
    expect(out.confidentEnough).toBe(true);
    const best = out.best as { object: { name: string }; reasons: string[] };
    expect(best.object.name).toBe("closeBtn");
    expect(best.reasons.length).toBeGreaterThan(0);
  });

  it("canvas_tap taps the confident match at absolute screen coordinates", async () => {
    vi.spyOn(webview, "resolveWebview").mockResolvedValue({ ok: true, data: WV });
    vi.spyOn(webview, "evalWebview").mockResolvedValue({
      ok: true,
      data: bridgeDump(
        [{ name: "closeBtn", x: 360, y: 20, text: "Close", interactable: true, bbox: { x: 350, y: 10, width: 20, height: 20 } }],
        "pixi",
        5,
        100
      ),
    });
    const tapSpy = vi.spyOn(gesture, "nativeTap").mockResolvedValue({ ok: true, backend: "idb", detail: "tapped" });
    const out = payload(await setup().get("canvas_tap")!({ udid: "U", intent: "close" }));
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
    const res = await setup().get("canvas_tap")!({ udid: "U", intent: "close" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not tapping|fail-closed/i);
    expect(tapSpy).not.toHaveBeenCalled();
  });

  it("canvas_hittest queries the bridge and reports the hit at screen coordinates", async () => {
    vi.spyOn(webview, "resolveWebview").mockResolvedValue({ ok: true, data: WV });
    const evalSpy = vi.spyOn(webview, "evalWebview").mockResolvedValue({
      ok: true,
      data: queryDump(
        { name: "closeBtn", x: 20, y: 30, bbox: { x: 10, y: 20, width: 20, height: 20 } },
        "pixi", 5, 100
      ),
    });
    const out = payload(await setup().get("canvas_hittest")!({ udid: "U", x: 19, y: 25 }));
    expect(evalSpy).toHaveBeenCalledOnce();
    expect(evalSpy.mock.calls[0][2]).toContain("window.__podiumCanvas.hitTest(19,25)");
    expect(out).toMatchObject({ framework: "pixi", x: 19, y: 25, screenX: 24, screenY: 189 });
    expect(out.hit).toMatchObject({ name: "closeBtn", source: "scene-graph" });
  });

  it("canvas_hittest returns null on a miss without tapping", async () => {
    vi.spyOn(webview, "resolveWebview").mockResolvedValue({ ok: true, data: WV });
    vi.spyOn(webview, "evalWebview").mockResolvedValue({ ok: true, data: queryDump(null, "unknown") });
    const tapSpy = vi.spyOn(gesture, "nativeTap");
    const out = payload(await setup().get("canvas_hittest")!({ udid: "U", x: 10, y: 20 }));
    expect(out.hit).toBeNull();
    expect(String(out.hint)).toMatch(/no canvas framework/i);
    expect(tapSpy).not.toHaveBeenCalled();
  });

  it("canvas_object_rect reports canvas-local and screen rectangles", async () => {
    vi.spyOn(webview, "resolveWebview").mockResolvedValue({ ok: true, data: WV });
    const evalSpy = vi.spyOn(webview, "evalWebview").mockResolvedValue({
      ok: true,
      data: queryDump({ x: 10, y: 20, width: 30, height: 40 }, "three", 5, 100),
    });
    const out = payload(await setup().get("canvas_object_rect")!({ udid: "U", name: 'menu"Close' }));
    expect(evalSpy.mock.calls[0][2]).toContain('window.__podiumCanvas.objectRect("menu\\"Close")');
    expect(out.rect).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    expect(out.screenRect).toEqual({ x: 15, y: 184, width: 30, height: 40 });
  });

  it("canvas_object_rect returns a miss and rejects malformed bridge geometry", async () => {
    vi.spyOn(webview, "resolveWebview").mockResolvedValue({ ok: true, data: WV });
    const evalSpy = vi.spyOn(webview, "evalWebview").mockResolvedValue({ ok: true, data: queryDump(null) });
    const handler = setup().get("canvas_object_rect")!;
    const miss = payload(await handler({ udid: "U", name: "missing" }));
    expect(miss.rect).toBeNull();
    expect(miss.screenRect).toBeNull();
    evalSpy.mockResolvedValue({ ok: true, data: queryDump({ x: 1, y: 2, width: "bad", height: 4 }) });
    const invalid = await handler({ udid: "U", name: "broken" });
    expect(invalid.isError).toBe(true);
    expect(invalid.content[0].text).toMatch(/invalid rectangle/i);
  });

  it("canvas tools respect the eval lockdown", async () => {
    process.env.PODIUM_DISABLE_WEBVIEW_EVAL = "1";
    const handlers = setup();
    for (const [name, args] of [
      ["canvas_inspect", { udid: "U" }],
      ["canvas_hittest", { udid: "U", x: 1, y: 2 }],
      ["canvas_object_rect", { udid: "U", name: "close" }],
    ] as const) {
      const res = await handlers.get(name)!(args);
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/disabled/i);
    }
  });

  it("surfaces a resolveWebview failure as an actionable error", async () => {
    vi.spyOn(webview, "resolveWebview").mockResolvedValue({ ok: false, error: "no inspectable WebView found" });
    const res = await setup().get("canvas_inspect")!({ udid: "U" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/no inspectable WebView/);
  });
});

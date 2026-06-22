import { describe, it, expect, vi, beforeEach } from "vitest";
import * as webviewLib from "./webview.js";
import * as nativeLib from "./native.js";

function wv(id: string, isVisible: boolean) {
  return { id, url: "https://x/", title: "t", bounds: { x: 0, y: 0, width: 100, height: 100 }, isVisible };
}

describe("detectSurface", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("reports webview (preferring the visible one) when an inspectable WebView exists", async () => {
    vi.spyOn(webviewLib, "listWebviews").mockResolvedValue({ ok: true, data: [wv("a", false), wv("b", true)] });
    const { detectSurface } = await import("./oracle.js");
    expect(await detectSurface("U")).toEqual({ surface: "webview", webviewId: "b" });
  });

  it("reports native when no inspectable WebView (list fails or empty)", async () => {
    vi.spyOn(webviewLib, "listWebviews").mockResolvedValue({ ok: false, error: "no backend" });
    const { detectSurface } = await import("./oracle.js");
    expect(await detectSurface("U")).toEqual({ surface: "native" });
  });
});

describe("targetingHint (US-5)", () => {
  it("distinguishes WebView (use webview_inspect) from native (add testID)", async () => {
    const { targetingHint } = await import("./oracle.js");
    expect(targetingHint("webview")).toMatch(/webview_inspect/);
    expect(targetingHint("webview")).toMatch(/WebView/);
    expect(targetingHint("native")).toMatch(/testID|accessibilityId/);
    expect(targetingHint("native")).toMatch(/tap_on/);
    expect(targetingHint("webview")).not.toEqual(targetingHint("native"));
  });
});

describe("checkVisible — precedence + fail-closed", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("WebView surface: confirms via DOM", async () => {
    vi.spyOn(webviewLib, "listWebviews").mockResolvedValue({ ok: true, data: [wv("b", true)] });
    vi.spyOn(webviewLib, "evalWebview").mockResolvedValue({ ok: true, data: "true" });
    const { checkVisible } = await import("./oracle.js");
    expect(await checkVisible("U", { selector: "#login" }, { timeoutMs: 0 })).toEqual({ visible: true, via: "webview-dom" });
  });

  it("WebView surface + DOM eval FAILS → unverifiable (fail closed, never a silent false)", async () => {
    vi.spyOn(webviewLib, "listWebviews").mockResolvedValue({ ok: true, data: [wv("b", true)] });
    vi.spyOn(webviewLib, "evalWebview").mockResolvedValue({ ok: false, error: "isInspectable=false" });
    const { checkVisible } = await import("./oracle.js");
    const r = await checkVisible("U", { text: "Error" }, { timeoutMs: 0 });
    expect(r.visible).toBeNull();
    expect(r.via).toBe("unverifiable");
  });

  it("native surface: confirms via a11y when the element is present", async () => {
    vi.spyOn(webviewLib, "listWebviews").mockResolvedValue({ ok: false, error: "native" });
    vi.spyOn(nativeLib, "getBackend").mockResolvedValue({
      describeAll: vi.fn(async () => [{ label: "Log In" }]),
    } as unknown as nativeLib.NativeBackend);
    const { checkVisible } = await import("./oracle.js");
    expect(await checkVisible("U", { text: "Log In" }, { timeoutMs: 0 })).toEqual({ visible: true, via: "native-a11y" });
  });

  it("native surface: reports visible:false via a11y on timeout when absent", async () => {
    vi.spyOn(webviewLib, "listWebviews").mockResolvedValue({ ok: false, error: "native" });
    vi.spyOn(nativeLib, "getBackend").mockResolvedValue({
      describeAll: vi.fn(async () => [{ label: "Other" }]),
    } as unknown as nativeLib.NativeBackend);
    const { checkVisible } = await import("./oracle.js");
    expect(await checkVisible("U", { text: "Missing" }, { timeoutMs: 0 })).toEqual({ visible: false, via: "native-a11y" });
  });

  it("native surface + contains:true matches a substring label (not just exact)", async () => {
    vi.spyOn(webviewLib, "listWebviews").mockResolvedValue({ ok: false, error: "native" });
    vi.spyOn(nativeLib, "getBackend").mockResolvedValue({
      describeAll: vi.fn(async () => [{ label: "General Settings" }]),
    } as unknown as nativeLib.NativeBackend);
    const { checkVisible } = await import("./oracle.js");
    // exact (default) fails — label is not exactly "General"
    expect((await checkVisible("U", { text: "General" }, { timeoutMs: 0 })).visible).toBe(false);
    // contains succeeds
    expect(await checkVisible("U", { text: "General" }, { timeoutMs: 0, contains: true })).toEqual({ visible: true, via: "native-a11y" });
  });

  it("native surface + selector-only → unverifiable (no DOM to query natively)", async () => {
    vi.spyOn(webviewLib, "listWebviews").mockResolvedValue({ ok: false, error: "native" });
    const { checkVisible } = await import("./oracle.js");
    const r = await checkVisible("U", { selector: ".foo" }, { timeoutMs: 0 });
    expect(r.visible).toBeNull();
    expect(r.via).toBe("unverifiable");
  });
});

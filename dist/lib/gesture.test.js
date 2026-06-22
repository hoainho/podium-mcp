import { describe, it, expect, vi, beforeEach } from "vitest";
import * as exec from "./exec.js";
import * as nativeLib from "./native.js";
import * as maestroLib from "./maestro.js";
// ─── nativeTap — native backend fast-path ─────────────────────────────────────
describe("nativeTap — native backend fast-path", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        // Ensure native cache is reset so mock backend is picked up cleanly.
        nativeLib._resetNativeCache();
    });
    it("returns ok:true with the backend name on a successful native tap", async () => {
        const fakeBackend = {
            name: "mobilecli",
            tap: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
            swipe: vi.fn(),
            inputText: vi.fn(),
            canPressKey: () => false,
            pressKey: vi.fn(),
            describeAll: vi.fn(),
            screenPoints: vi.fn(),
            setOrientation: vi.fn(),
        };
        vi.spyOn(nativeLib, "getBackend").mockResolvedValue(fakeBackend);
        const { nativeTap } = await import("./gesture.js");
        const result = await nativeTap("FAKE-UDID", 100, 200);
        expect(result.ok).toBe(true);
        expect(result.backend).toBe("mobilecli");
        expect(fakeBackend.tap).toHaveBeenCalledWith("FAKE-UDID", 100, 200);
    });
    it("falls through to Maestro when the native tap returns non-zero", async () => {
        const fakeBackend = {
            name: "mobilecli",
            tap: vi.fn(async () => ({ code: 1, stdout: "", stderr: "tap error" })),
            swipe: vi.fn(),
            inputText: vi.fn(),
            canPressKey: () => false,
            pressKey: vi.fn(),
            describeAll: vi.fn(),
            screenPoints: vi.fn(),
            setOrientation: vi.fn(),
        };
        vi.spyOn(nativeLib, "getBackend").mockResolvedValue(fakeBackend);
        vi.spyOn(maestroLib, "runMaestroFlow").mockResolvedValue({
            passed: true,
            retries: 0,
            steps: [],
            rawOutput: "",
            durationMs: 1,
        });
        const { nativeTap } = await import("./gesture.js");
        const result = await nativeTap("FAKE-UDID", 100, 200, { bundleId: "com.example.app" });
        // Native failed → Maestro ran
        expect(result.ok).toBe(true);
        expect(result.backend).toBe("maestro");
        expect(maestroLib.runMaestroFlow).toHaveBeenCalledOnce();
    });
});
// ─── nativeTap — Maestro fallback (no native backend) ─────────────────────────
describe("nativeTap — Maestro fallback when no native backend", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        nativeLib._resetNativeCache();
    });
    it("calls runMaestroFlow with a tapOn-point YAML when bundleId is provided", async () => {
        vi.spyOn(nativeLib, "getBackend").mockResolvedValue(null);
        const flowSpy = vi.spyOn(maestroLib, "runMaestroFlow").mockResolvedValue({
            passed: true,
            retries: 0,
            steps: [],
            rawOutput: "",
            durationMs: 5,
        });
        const { nativeTap } = await import("./gesture.js");
        const result = await nativeTap("FAKE-UDID", 150, 300, { bundleId: "com.example.app" });
        expect(result.ok).toBe(true);
        expect(result.backend).toBe("maestro");
        expect(flowSpy).toHaveBeenCalledOnce();
        const opts = flowSpy.mock.calls[0][0];
        expect(opts.udid).toBe("FAKE-UDID");
        expect(opts.yaml).toContain("com.example.app");
        expect(opts.yaml).toContain("tapOn");
        expect(opts.yaml).toContain("150,300");
    });
    it("constructs correct YAML with appId header and tapOn point", async () => {
        vi.spyOn(nativeLib, "getBackend").mockResolvedValue(null);
        let capturedYaml = "";
        vi.spyOn(maestroLib, "runMaestroFlow").mockImplementation(async (opts) => {
            capturedYaml = opts.yaml ?? "";
            return { passed: true, retries: 0, steps: [], rawOutput: "", durationMs: 1 };
        });
        const { nativeTap } = await import("./gesture.js");
        await nativeTap("FAKE-UDID", 50, 75, { bundleId: "com.bundle.id" });
        expect(capturedYaml).toContain("appId: com.bundle.id");
        expect(capturedYaml).toContain('point: "50,75"');
    });
    it("auto-detects the foreground app when bundleId is omitted", async () => {
        vi.spyOn(nativeLib, "getBackend").mockResolvedValue(null);
        // Simulate launchctl list returning a running app
        vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 0,
            stdout: "- 0 UIKitApplication:com.detected.app[0x1234]",
            stderr: "",
        });
        vi.spyOn(maestroLib, "runMaestroFlow").mockResolvedValue({
            passed: true,
            retries: 0,
            steps: [],
            rawOutput: "",
            durationMs: 1,
        });
        const { nativeTap } = await import("./gesture.js");
        const result = await nativeTap("FAKE-UDID", 10, 20);
        expect(result.ok).toBe(true);
        expect(result.backend).toBe("maestro");
        expect(maestroLib.runMaestroFlow).toHaveBeenCalledOnce();
        const opts = maestroLib.runMaestroFlow.mock.calls[0][0];
        expect(opts.yaml).toContain("com.detected.app");
    });
    it("returns ok:false when no backend and no foreground app can be detected", async () => {
        vi.spyOn(nativeLib, "getBackend").mockResolvedValue(null);
        // launchctl list returns nothing useful
        vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 0,
            stdout: "- 0 com.apple.CoreSimulator",
            stderr: "",
        });
        const { nativeTap } = await import("./gesture.js");
        const result = await nativeTap("FAKE-UDID", 10, 20);
        expect(result.ok).toBe(false);
        expect(result.backend).toBe("maestro");
        expect(result.detail).toMatch(/no tap backend available/i);
    });
    it("returns ok:false when runMaestroFlow reports passed:false", async () => {
        vi.spyOn(nativeLib, "getBackend").mockResolvedValue(null);
        vi.spyOn(maestroLib, "runMaestroFlow").mockResolvedValue({
            passed: false,
            retries: 2,
            steps: [],
            rawOutput: "Flow did not pass",
            durationMs: 500,
        });
        const { nativeTap } = await import("./gesture.js");
        const result = await nativeTap("FAKE-UDID", 10, 20, { bundleId: "com.example.app" });
        expect(result.ok).toBe(false);
        expect(result.backend).toBe("maestro");
        expect(result.detail).toContain("Flow did not pass");
    });
    it("returns ok:false when runMaestroFlow throws", async () => {
        vi.spyOn(nativeLib, "getBackend").mockResolvedValue(null);
        vi.spyOn(maestroLib, "runMaestroFlow").mockRejectedValue(new Error("maestro binary not found"));
        const { nativeTap } = await import("./gesture.js");
        const result = await nativeTap("FAKE-UDID", 10, 20, { bundleId: "com.example.app" });
        expect(result.ok).toBe(false);
        expect(result.detail).toContain("maestro binary not found");
    });
});
// ─── resolveForegroundApp — launchctl parsing ─────────────────────────────────
describe("resolveForegroundApp", () => {
    beforeEach(() => vi.restoreAllMocks());
    it("returns the bundle id extracted from UIKitApplication label", async () => {
        vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 0,
            stdout: [
                "- 0 com.apple.backboardd",
                "- 0 UIKitApplication:com.example.MyApp[0x1a2b]",
            ].join("\n"),
            stderr: "",
        });
        const { resolveForegroundApp } = await import("./gesture.js");
        const id = await resolveForegroundApp("FAKE-UDID");
        expect(id).toBe("com.example.MyApp");
    });
    it("returns null when no UIKitApplication label is present", async () => {
        vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 0,
            stdout: "- 0 com.apple.backboardd\n- 0 com.apple.springboard",
            stderr: "",
        });
        const { resolveForegroundApp } = await import("./gesture.js");
        const id = await resolveForegroundApp("FAKE-UDID");
        expect(id).toBeNull();
    });
    it("returns null when launchctl exits non-zero", async () => {
        vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 1,
            stdout: "",
            stderr: "permission denied",
        });
        const { resolveForegroundApp } = await import("./gesture.js");
        const id = await resolveForegroundApp("FAKE-UDID");
        expect(id).toBeNull();
    });
    it("passes the correct xcrun simctl spawn launchctl list args", async () => {
        const spy = vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 0,
            stdout: "UIKitApplication:com.test.app[0x0]",
            stderr: "",
        });
        const { resolveForegroundApp } = await import("./gesture.js");
        await resolveForegroundApp("MY-UDID");
        const [cmd, args] = spy.mock.calls[0];
        expect(cmd).toBe("xcrun");
        expect(args).toEqual(["simctl", "spawn", "MY-UDID", "launchctl", "list"]);
    });
});
// ─── Shared gesture executors (R5) ────────────────────────────────────────────
const OK = { code: 0, stdout: "", stderr: "" };
function makeBackend(overrides = {}) {
    return {
        name: "mobilecli",
        tap: vi.fn(async () => OK),
        swipe: vi.fn(async () => OK),
        inputText: vi.fn(async () => OK),
        canPressKey: () => false,
        pressKey: vi.fn(async () => OK),
        describeAll: vi.fn(async () => []),
        screenPoints: vi.fn(async () => ({ w: 402, h: 874 })),
        setOrientation: vi.fn(async () => null),
        ...overrides,
    };
}
describe("shared gesture executors", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        nativeLib._resetNativeCache();
    });
    it("nativeKey: native mapping wins and no Maestro flow runs", async () => {
        vi.spyOn(nativeLib, "getBackend").mockResolvedValue(makeBackend({ canPressKey: () => true, pressKey: vi.fn(async () => OK) }));
        const flow = vi.spyOn(maestroLib, "runMaestroFlow");
        const { nativeKey } = await import("./gesture.js");
        const g = await nativeKey("U", "home");
        expect(g.ok).toBe(true);
        expect(g.backend).toBe("mobilecli");
        expect(flow).not.toHaveBeenCalled();
    });
    it("nativeKey: Maestro fallback YAML includes launchApp only when requested", async () => {
        vi.spyOn(nativeLib, "getBackend").mockResolvedValue(null);
        let yaml = "";
        vi.spyOn(maestroLib, "runMaestroFlow").mockImplementation(async (opts) => {
            yaml = opts.yaml ?? "";
            return { passed: true, retries: 0, steps: [], rawOutput: "", durationMs: 1 };
        });
        const { nativeKey } = await import("./gesture.js");
        await nativeKey("U", "back", { bundleId: "com.x", launchApp: true });
        expect(yaml).toContain("appId: com.x");
        expect(yaml).toContain("launchApp");
        expect(yaml).toContain('pressKey: "Back"');
        await nativeKey("U", "back", { bundleId: "com.x", launchApp: false });
        expect(yaml).not.toContain("launchApp");
    });
    it("nativeSwipe: percent overrides resolve against screen dims for the native path", async () => {
        const swipeSpy = vi.fn(async () => OK);
        vi.spyOn(nativeLib, "getBackend").mockResolvedValue(makeBackend({ screenPoints: vi.fn(async () => ({ w: 400, h: 800 })), swipe: swipeSpy }));
        const { nativeSwipe } = await import("./gesture.js");
        const g = await nativeSwipe("U", {
            overrides: { startX: "50%", startY: "25%", endX: "50%", endY: "75%" },
        });
        expect(g.ok).toBe(true);
        expect(g.points).toEqual({ x1: 200, y1: 200, x2: 200, y2: 600 });
        expect(swipeSpy).toHaveBeenCalledWith("U", 200, 200, 200, 600);
    });
    // R5 parity: the swipe tool (screen.ts) and the run_steps swipe step (steps.ts)
    // must resolve to identical native points because they share nativeSwipe.
    it("parity: swipe tool and run_steps swipe produce identical native points", async () => {
        const swipeCalls = [];
        const backend = makeBackend({
            screenPoints: vi.fn(async () => ({ w: 402, h: 874 })),
            swipe: vi.fn(async (_u, x1, y1, x2, y2) => {
                swipeCalls.push([x1, y1, x2, y2]);
                return OK;
            }),
        });
        vi.spyOn(nativeLib, "getBackend").mockResolvedValue(backend);
        function fakeServer() {
            const h = new Map();
            return { h, tool: (n, _d, _s, fn) => h.set(n, fn) };
        }
        const { registerScreenTools } = await import("../tools/screen.js");
        const s1 = fakeServer();
        registerScreenTools(s1);
        await s1.h.get("swipe")({ udid: "U", bundleId: "com.x", direction: "up" });
        const { registerStepsTools } = await import("../tools/steps.js");
        const s2 = fakeServer();
        registerStepsTools(s2);
        await s2.h.get("run_steps")({ udid: "U", steps: [{ action: "swipe", direction: "up" }] });
        expect(swipeCalls).toHaveLength(2);
        expect(swipeCalls[0]).toEqual(swipeCalls[1]);
    });
});

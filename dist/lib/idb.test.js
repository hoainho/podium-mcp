import { describe, it, expect, vi, beforeEach } from "vitest";
import * as exec from "./exec.js";
// ─── idbDescribeAll — JSON array vs NDJSON vs unparseable ─────────────────────
describe("idbDescribeAll — output format parsing", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        // Reset the idb availability cache so commandExists mocks are respected.
        import("./idb.js").then(({ _resetIdbCache }) => _resetIdbCache());
    });
    it("parses a JSON array response correctly", async () => {
        const elements = [
            { AXLabel: "Log In", frame: { x: 10, y: 20, width: 100, height: 40 } },
            { AXLabel: "Sign Up", AXValue: "action", frame: { x: 10, y: 80, width: 100, height: 40 } },
        ];
        vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 0,
            stdout: JSON.stringify(elements),
            stderr: "",
        });
        const { idbDescribeAll } = await import("./idb.js");
        const result = await idbDescribeAll("FAKE-UDID");
        expect(result.ok).toBe(true);
        if (!result.ok)
            return;
        expect(result.elements).toHaveLength(2);
        expect(result.elements[0].AXLabel).toBe("Log In");
        expect(result.elements[1].AXValue).toBe("action");
    });
    it("parses newline-delimited JSON objects (real idb output format)", async () => {
        // idb ui describe-all emits one JSON object per line, not a wrapped array.
        const ndjson = [
            JSON.stringify({ AXLabel: "Home", frame: { x: 0, y: 0, width: 50, height: 50 } }),
            JSON.stringify({ AXLabel: "Back", frame: { x: 60, y: 0, width: 50, height: 50 } }),
        ].join("\n");
        vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 0,
            stdout: ndjson,
            stderr: "",
        });
        const { idbDescribeAll } = await import("./idb.js");
        const result = await idbDescribeAll("FAKE-UDID");
        expect(result.ok).toBe(true);
        if (!result.ok)
            return;
        expect(result.elements).toHaveLength(2);
        expect(result.elements[0].AXLabel).toBe("Home");
        expect(result.elements[1].AXLabel).toBe("Back");
    });
    it("skips non-JSON lines in NDJSON output without failing", async () => {
        const ndjson = [
            "idb_companion: connected",
            JSON.stringify({ AXLabel: "Submit" }),
            "",
            "some debug line",
            JSON.stringify({ AXLabel: "Cancel" }),
        ].join("\n");
        vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 0,
            stdout: ndjson,
            stderr: "",
        });
        const { idbDescribeAll } = await import("./idb.js");
        const result = await idbDescribeAll("FAKE-UDID");
        expect(result.ok).toBe(true);
        if (!result.ok)
            return;
        expect(result.elements).toHaveLength(2);
        expect(result.elements[0].AXLabel).toBe("Submit");
        expect(result.elements[1].AXLabel).toBe("Cancel");
    });
    it("returns ok:false when stdout is completely unparseable", async () => {
        vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 0,
            stdout: "Fatal: unable to connect to idb_companion\nStack trace ...",
            stderr: "",
        });
        const { idbDescribeAll } = await import("./idb.js");
        const result = await idbDescribeAll("FAKE-UDID");
        expect(result.ok).toBe(false);
        if (result.ok)
            return;
        expect(result.text).toContain("unable to connect");
    });
    it("returns ok:false when the command exits non-zero", async () => {
        vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 1,
            stdout: "",
            stderr: "idb_companion not running",
        });
        const { idbDescribeAll } = await import("./idb.js");
        const result = await idbDescribeAll("FAKE-UDID");
        expect(result.ok).toBe(false);
        if (result.ok)
            return;
        expect(result.text).toContain("idb_companion not running");
    });
    it("wraps a single JSON object (not array) in an array", async () => {
        const single = { AXLabel: "Only Element", frame: { x: 0, y: 0, width: 100, height: 40 } };
        vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 0,
            stdout: JSON.stringify(single),
            stderr: "",
        });
        const { idbDescribeAll } = await import("./idb.js");
        const result = await idbDescribeAll("FAKE-UDID");
        expect(result.ok).toBe(true);
        if (!result.ok)
            return;
        expect(result.elements).toHaveLength(1);
        expect(result.elements[0].AXLabel).toBe("Only Element");
    });
});
// ─── idbAvailable — cache behaviour ──────────────────────────────────────────
describe("idbAvailable — cache", () => {
    beforeEach(async () => {
        vi.restoreAllMocks();
        const { _resetIdbCache } = await import("./idb.js");
        _resetIdbCache();
    });
    it("returns false when both idb and idb_companion are absent", async () => {
        vi.spyOn(exec, "commandExists").mockResolvedValue(false);
        const { idbAvailable } = await import("./idb.js");
        const result = await idbAvailable();
        expect(result).toBe(false);
    });
    it("returns false when only idb CLI is present but companion is missing", async () => {
        vi.spyOn(exec, "commandExists").mockImplementation(async (cmd) => cmd === "idb");
        const { idbAvailable, _resetIdbCache } = await import("./idb.js");
        _resetIdbCache();
        const result = await idbAvailable();
        expect(result).toBe(false);
    });
    it("returns true when both idb and idb_companion are present", async () => {
        vi.spyOn(exec, "commandExists").mockResolvedValue(true);
        const { idbAvailable, _resetIdbCache } = await import("./idb.js");
        _resetIdbCache();
        const result = await idbAvailable();
        expect(result).toBe(true);
    });
    it("caches the result so commandExists is not called twice", async () => {
        const spy = vi.spyOn(exec, "commandExists").mockResolvedValue(false);
        const { idbAvailable, _resetIdbCache } = await import("./idb.js");
        _resetIdbCache();
        await idbAvailable();
        await idbAvailable(); // second call should use cache
        // commandExists is called twice per idbAvailable call (idb + idb_companion)
        // but only on the FIRST invocation — second call is cached
        expect(spy.mock.calls.length).toBe(2);
    });
});
// ─── idbCanPressKey ───────────────────────────────────────────────────────────
describe("idbCanPressKey", () => {
    it("returns true for 'home'", async () => {
        const { idbCanPressKey } = await import("./idb.js");
        expect(idbCanPressKey("home")).toBe(true);
    });
    it("returns true for 'lock'", async () => {
        const { idbCanPressKey } = await import("./idb.js");
        expect(idbCanPressKey("lock")).toBe(true);
    });
    it("returns true for 'enter' (HID keycode mapping)", async () => {
        const { idbCanPressKey } = await import("./idb.js");
        expect(idbCanPressKey("enter")).toBe(true);
    });
    it("returns false for an unmapped key", async () => {
        const { idbCanPressKey } = await import("./idb.js");
        expect(idbCanPressKey("volume up")).toBe(false);
    });
});
// ─── idbPressKey — routing ────────────────────────────────────────────────────
describe("idbPressKey", () => {
    beforeEach(() => vi.restoreAllMocks());
    it("calls 'idb ui button' for 'home'", async () => {
        const spy = vi.spyOn(exec, "run").mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
        const { idbPressKey } = await import("./idb.js");
        await idbPressKey("FAKE-UDID", "home");
        expect(spy).toHaveBeenCalledOnce();
        const [cmd, args] = spy.mock.calls[0];
        expect(cmd).toBe("idb");
        expect(args).toContain("button");
        expect(args).toContain("HOME");
    });
    it("calls 'idb ui key' for 'enter' (HID code 40)", async () => {
        const spy = vi.spyOn(exec, "run").mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
        const { idbPressKey } = await import("./idb.js");
        await idbPressKey("FAKE-UDID", "enter");
        expect(spy).toHaveBeenCalledOnce();
        const [cmd, args] = spy.mock.calls[0];
        expect(cmd).toBe("idb");
        expect(args).toContain("key");
        expect(args).toContain("40");
    });
    it("returns null for an unmapped key without calling run", async () => {
        const spy = vi.spyOn(exec, "run");
        const { idbPressKey } = await import("./idb.js");
        const result = await idbPressKey("FAKE-UDID", "volume up");
        expect(result).toBeNull();
        expect(spy).not.toHaveBeenCalled();
    });
});

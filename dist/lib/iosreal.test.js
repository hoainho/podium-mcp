import { describe, it, expect, vi, afterEach } from "vitest";
import * as exec from "./exec.js";
import { parseDevicectlDevices, iosRealDriver } from "./iosreal.js";
const FIXTURE = JSON.stringify({
    result: {
        devices: [
            {
                identifier: "00008030-AAA",
                deviceProperties: { name: "Nhon iPhone" },
                connectionProperties: { tunnelState: "connected", pairingState: "paired" },
                hardwareProperties: { platform: "iOS", deviceType: "iPhone" },
            },
            {
                identifier: "WATCH-1",
                deviceProperties: { name: "Watch" },
                hardwareProperties: { platform: "watchOS" },
            },
        ],
    },
});
describe("parseDevicectlDevices", () => {
    it("extracts iOS devices with name + connection state, filtering non-iOS", () => {
        expect(parseDevicectlDevices(FIXTURE)).toEqual([
            { udid: "00008030-AAA", platform: "ios-real", name: "Nhon iPhone", state: "paired", transport: "usb" },
        ]);
    });
    it("accepts a bare {devices:[...]} shape and falls back name→udid", () => {
        expect(parseDevicectlDevices(JSON.stringify({ devices: [{ identifier: "U1" }] }))).toEqual([
            { udid: "U1", platform: "ios-real", name: "U1", state: "unknown", transport: "usb" },
        ]);
    });
    it("returns [] on bad JSON or missing device array", () => {
        expect(parseDevicectlDevices("not json")).toEqual([]);
        expect(parseDevicectlDevices(JSON.stringify({ result: {} }))).toEqual([]);
    });
});
describe("iosRealDriver", () => {
    afterEach(() => vi.restoreAllMocks());
    it("declares platform ios-real", () => {
        expect(iosRealDriver.platform).toBe("ios-real");
    });
    it("list() returns [] when devicectl fails (no Xcode / no device)", async () => {
        vi.spyOn(exec, "run").mockResolvedValue({ code: 1, stdout: "", stderr: "xcrun: devicectl unavailable" });
        expect(await iosRealDriver.list()).toEqual([]);
    });
    it("terminate fails closed, pointing at the WDA backend", async () => {
        const r = await iosRealDriver.terminate("U1", "com.app");
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/WDA backend/i);
    });
    it("screenSize returns null (provided via WDA)", async () => {
        expect(await iosRealDriver.screenSize("U1")).toBeNull();
    });
    it("screenshot uses idb when available", async () => {
        vi.spyOn(exec, "commandExists").mockImplementation(async (c) => c === "idb");
        const spy = vi.spyOn(exec, "run").mockResolvedValue({ code: 0, stdout: "", stderr: "" });
        const r = await iosRealDriver.screenshot("UDID", "/tmp/x.png");
        expect(r.ok).toBe(true);
        expect(spy).toHaveBeenCalledWith("idb", ["screenshot", "/tmp/x.png", "--udid", "UDID"], expect.anything());
    });
    it("screenshot falls back to idevicescreenshot when idb is absent", async () => {
        vi.spyOn(exec, "commandExists").mockImplementation(async (c) => c === "idevicescreenshot");
        const spy = vi.spyOn(exec, "run").mockResolvedValue({ code: 0, stdout: "", stderr: "" });
        await iosRealDriver.screenshot("UDID", "/tmp/x.png");
        expect(spy).toHaveBeenCalledWith("idevicescreenshot", ["-u", "UDID", "/tmp/x.png"], expect.anything());
    });
    it("screenshot fails closed with install guidance when neither tool is present", async () => {
        vi.spyOn(exec, "commandExists").mockResolvedValue(false);
        const r = await iosRealDriver.screenshot("UDID", "/tmp/x.png");
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/idb_companion|libimobiledevice/);
    });
    it("screenshot gives an actionable error when idb is present but fails (no companion, no fallback)", async () => {
        vi.spyOn(exec, "commandExists").mockImplementation(async (c) => c === "idb");
        vi.spyOn(exec, "run").mockResolvedValue({ code: 1, stdout: "", stderr: "Exception thrown in main\n  Traceback…" });
        const r = await iosRealDriver.screenshot("UDID", "/tmp/x.png");
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/idb_companion/);
    });
    it("screenshot falls through to idevicescreenshot when idb is present but fails", async () => {
        vi.spyOn(exec, "commandExists").mockResolvedValue(true); // both idb and idevicescreenshot present
        const spy = vi
            .spyOn(exec, "run")
            .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "idb error (no companion)" }) // idb fails
            .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" }); // idevicescreenshot succeeds
        const r = await iosRealDriver.screenshot("UDID", "/tmp/x.png");
        expect(r.ok).toBe(true);
        expect(spy.mock.calls[0][0]).toBe("idb");
        expect(spy.mock.calls[1][0]).toBe("idevicescreenshot");
    });
});

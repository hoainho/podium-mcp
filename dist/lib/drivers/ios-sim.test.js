import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as exec from "../exec.js";
import { _resetDeviceCache } from "../simctl.js";
import { iosSimDriver } from "./ios-sim.js";
import { getBackendFor } from "../native.js";
const SIM_LIST_JSON = JSON.stringify({
    devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-18-5": [
            {
                udid: "SIM-1",
                name: "iPhone 16 Pro",
                state: "Booted",
                isAvailable: true,
                deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro",
            },
        ],
    },
});
describe("iosSimDriver", () => {
    beforeEach(() => _resetDeviceCache());
    afterEach(() => vi.restoreAllMocks());
    it("declares platform ios-sim", () => {
        expect(iosSimDriver.platform).toBe("ios-sim");
    });
    it("list() maps simctl devices to DeviceTarget with platform/transport tags", async () => {
        vi.spyOn(exec, "run").mockResolvedValue({ code: 0, stdout: SIM_LIST_JSON, stderr: "" });
        const targets = await iosSimDriver.list();
        expect(targets).toEqual([
            {
                udid: "SIM-1",
                platform: "ios-sim",
                name: "iPhone 16 Pro",
                state: "Booted",
                transport: "simulator",
            },
        ]);
    });
    it("list() returns [] when simctl fails (degrade, don't throw)", async () => {
        vi.spyOn(exec, "run").mockResolvedValue({ code: 1, stdout: "", stderr: "xcrun not found" });
        expect(await iosSimDriver.list()).toEqual([]);
    });
    it("screenSize() maps a successful measureScreen result", async () => {
        vi.spyOn(exec, "run").mockImplementation(async (cmd) => cmd === "sips"
            ? { code: 0, stdout: "pixelWidth: 1206\npixelHeight: 2622", stderr: "" }
            : { code: 0, stdout: "", stderr: "" });
        expect(await iosSimDriver.screenSize("SIM-1")).toEqual({ widthPx: 1206, heightPx: 2622 });
    });
    it("screenSize() returns null when the screen cannot be measured", async () => {
        vi.spyOn(exec, "run").mockResolvedValue({ code: 1, stdout: "", stderr: "boom" });
        expect(await iosSimDriver.screenSize("SIM-1")).toBeNull();
    });
});
describe("getBackendFor (per-target backend seam)", () => {
    const prev = process.env.PODIUM_DISABLE_NATIVE;
    beforeEach(() => {
        process.env.PODIUM_DISABLE_NATIVE = "1";
    });
    afterEach(() => {
        vi.restoreAllMocks();
        if (prev === undefined)
            delete process.env.PODIUM_DISABLE_NATIVE;
        else
            process.env.PODIUM_DISABLE_NATIVE = prev;
    });
    it("android: returns the adb backend when adb is present, null when absent", async () => {
        const adb = vi.spyOn(exec, "commandExists");
        adb.mockResolvedValue(true);
        expect((await getBackendFor("android"))?.name).toBe("adb");
        adb.mockResolvedValue(false);
        expect(await getBackendFor("android")).toBeNull();
    });
    it("delegates ios-sim to getBackend (null when native is disabled)", async () => {
        expect(await getBackendFor("ios-sim")).toBeNull();
    });
});

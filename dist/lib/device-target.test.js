import { describe, it, expect, beforeEach } from "vitest";
import { detectPlatform, resolvePlatform, registerDriver, getDriver, registeredPlatforms, listAllTargets, _resetDrivers, } from "./device-target.js";
function stubDriver(platform, targets, opts = {}) {
    return {
        platform,
        list: async () => {
            if (opts.listThrows)
                throw new Error("boom");
            return targets;
        },
        install: async () => ({ ok: true }),
        launch: async () => ({ ok: true }),
        terminate: async () => ({ ok: true }),
        screenshot: async () => ({ ok: true }),
        screenSize: async () => null,
    };
}
describe("detectPlatform", () => {
    it("classifies a simulator UDID (8-4-4-4-12 UUID) as ios-sim", () => {
        expect(detectPlatform("74DD7D29-38BC-4B82-B92A-FFA7E0C15F74")).toBe("ios-sim");
    });
    it("classifies a 40-hex real-iPhone UDID as ios-real", () => {
        expect(detectPlatform("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0")).toBe("ios-real");
    });
    it("classifies an A12+ real-iPhone UDID (8-16 hex) as ios-real", () => {
        expect(detectPlatform("00008030-001A2C3D4E5F6A7B")).toBe("ios-real");
    });
    it("classifies an emulator serial as android", () => {
        expect(detectPlatform("emulator-5554")).toBe("android");
    });
    it("classifies an alphanumeric adb serial as android", () => {
        expect(detectPlatform("R5CT91XYZ12")).toBe("android");
    });
    it("trims whitespace before classifying", () => {
        expect(detectPlatform("  74DD7D29-38BC-4B82-B92A-FFA7E0C15F74  ")).toBe("ios-sim");
    });
});
describe("driver registry", () => {
    beforeEach(() => _resetDrivers());
    it("registers and retrieves a driver by platform", () => {
        const d = stubDriver("android", []);
        registerDriver(d);
        expect(getDriver("android")).toBe(d);
        expect(getDriver("ios-real")).toBeUndefined();
    });
    it("reports registered platforms", () => {
        registerDriver(stubDriver("ios-sim", []));
        registerDriver(stubDriver("android", []));
        expect(registeredPlatforms().sort()).toEqual(["android", "ios-sim"]);
    });
    it("replaces an existing driver for the same platform", () => {
        const first = stubDriver("android", []);
        const second = stubDriver("android", []);
        registerDriver(first);
        registerDriver(second);
        expect(getDriver("android")).toBe(second);
        expect(registeredPlatforms()).toEqual(["android"]);
    });
});
describe("listAllTargets", () => {
    beforeEach(() => _resetDrivers());
    it("returns [] when no drivers are registered", async () => {
        expect(await listAllTargets()).toEqual([]);
    });
    it("merges targets across all registered drivers", async () => {
        registerDriver(stubDriver("ios-sim", [{ udid: "SIM-1", platform: "ios-sim", name: "iPhone 16 Pro" }]));
        registerDriver(stubDriver("android", [{ udid: "emulator-5554", platform: "android", name: "Pixel 8" }]));
        const all = await listAllTargets();
        expect(all).toHaveLength(2);
        expect(all.map((t) => t.platform).sort()).toEqual(["android", "ios-sim"]);
    });
    it("degrades: a driver whose list() throws contributes nothing but does not abort", async () => {
        registerDriver(stubDriver("ios-sim", [{ udid: "SIM-1", platform: "ios-sim" }]));
        registerDriver(stubDriver("android", [], { listThrows: true }));
        const all = await listAllTargets();
        expect(all).toHaveLength(1);
        expect(all[0].platform).toBe("ios-sim");
    });
});
describe("resolvePlatform (authoritative via device list)", () => {
    beforeEach(() => _resetDrivers());
    it("trusts the driver-tagged platform over the format heuristic (real CoreDevice UUID)", async () => {
        // A real iPhone 12 Pro Max reports a UUID indistinguishable from a sim UDID.
        const realUdid = "E4EFAC0A-3C30-5424-9217-309584C18D2C";
        registerDriver(stubDriver("ios-real", [{ udid: realUdid, platform: "ios-real" }]));
        expect(detectPlatform(realUdid)).toBe("ios-sim"); // heuristic is wrong here…
        expect(await resolvePlatform(realUdid)).toBe("ios-real"); // …authoritative is correct
    });
    it("falls back to the heuristic when the device is not listed", async () => {
        expect(await resolvePlatform("emulator-5554")).toBe("android");
    });
});

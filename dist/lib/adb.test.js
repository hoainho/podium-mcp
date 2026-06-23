import { describe, it, expect, vi, afterEach } from "vitest";
import * as exec from "./exec.js";
import { parseAdbDevices, parseWmSize, androidDriver } from "./adb.js";
describe("parseAdbDevices", () => {
    it("parses `adb devices -l` with model name and transport", () => {
        const out = [
            "List of devices attached",
            "emulator-5554          device product:sdk_gphone64 model:Pixel_8 device:emu64a transport_id:1",
            "R5CT91XYZ12            device product:p model:Galaxy_S23 device:d transport_id:2",
            "192.168.1.5:5555       device product:p model:Wifi_Dev device:d transport_id:3",
        ].join("\n");
        expect(parseAdbDevices(out)).toEqual([
            { udid: "emulator-5554", platform: "android", name: "Pixel 8", state: "device", transport: "usb" },
            { udid: "R5CT91XYZ12", platform: "android", name: "Galaxy S23", state: "device", transport: "usb" },
            { udid: "192.168.1.5:5555", platform: "android", name: "Wifi Dev", state: "device", transport: "network" },
        ]);
    });
    it("skips daemon notices/blank lines and falls back to serial when no model", () => {
        const out = [
            "List of devices attached",
            "* daemon not running; starting now at tcp:5037 *",
            "* daemon started successfully *",
            "emulator-5554\tdevice",
            "",
        ].join("\n");
        expect(parseAdbDevices(out)).toEqual([
            { udid: "emulator-5554", platform: "android", name: "emulator-5554", state: "device", transport: "usb" },
        ]);
    });
    it("captures non-ready states (unauthorized/offline)", () => {
        expect(parseAdbDevices("List of devices attached\nR5CT91XYZ12   unauthorized")[0].state).toBe("unauthorized");
    });
});
describe("parseWmSize", () => {
    it("reads Physical size", () => {
        expect(parseWmSize("Physical size: 1080x2400")).toEqual({ widthPx: 1080, heightPx: 2400 });
    });
    it("prefers Override size when present", () => {
        expect(parseWmSize("Physical size: 1080x2400\nOverride size: 720x1280")).toEqual({
            widthPx: 720,
            heightPx: 1280,
        });
    });
    it("returns null when unparseable", () => {
        expect(parseWmSize("nonsense")).toBeNull();
    });
});
describe("androidDriver", () => {
    afterEach(() => vi.restoreAllMocks());
    it("declares platform android", () => {
        expect(androidDriver.platform).toBe("android");
    });
    it("list() returns only ready devices (state === device)", async () => {
        vi.spyOn(exec, "run").mockResolvedValue({
            code: 0,
            stdout: ["List of devices attached", "emulator-5554 device model:Pixel_8", "R5CT offline"].join("\n"),
            stderr: "",
        });
        const targets = await androidDriver.list();
        expect(targets).toHaveLength(1);
        expect(targets[0].udid).toBe("emulator-5554");
    });
    it("list() returns [] when adb fails (degrade, don't throw)", async () => {
        vi.spyOn(exec, "run").mockResolvedValue({ code: 1, stdout: "", stderr: "adb: command not found" });
        expect(await androidDriver.list()).toEqual([]);
    });
    it("screenSize() parses `wm size`", async () => {
        vi.spyOn(exec, "run").mockResolvedValue({ code: 0, stdout: "Physical size: 1080x2400", stderr: "" });
        expect(await androidDriver.screenSize("emulator-5554")).toEqual({ widthPx: 1080, heightPx: 2400 });
    });
    it("install() maps a successful adb result to DriverResult.ok", async () => {
        vi.spyOn(exec, "run").mockResolvedValue({ code: 0, stdout: "Success", stderr: "" });
        expect((await androidDriver.install("emulator-5554", "/tmp/app.apk")).ok).toBe(true);
    });
    it("screenshot() runs screencap → pull → rm and succeeds on pull", async () => {
        const spy = vi.spyOn(exec, "run").mockResolvedValue({ code: 0, stdout: "", stderr: "" });
        const r = await androidDriver.screenshot("emulator-5554", "/tmp/x.png");
        expect(r.ok).toBe(true);
        expect(spy).toHaveBeenCalledTimes(3);
    });
});

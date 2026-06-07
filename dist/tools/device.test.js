import { describe, it, expect, vi, beforeEach } from "vitest";
import * as exec from "../lib/exec.js";
import * as simctl from "../lib/simctl.js";
import * as recording from "../lib/recording.js";
function makeFakeServer() {
    const _handlers = new Map();
    return {
        _handlers,
        tool(name, _description, _schema, handler) {
            _handlers.set(name, handler);
        },
    };
}
// ─── Sample simctl JSON ───────────────────────────────────────────────────────
const SAMPLE_SIMCTL_JSON = JSON.stringify({
    devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-18-5": [
            {
                udid: "74DD7D29-38BC-4B82-B92A-FFA7E0C15F74",
                name: "iPhone 16 Pro",
                state: "Booted",
                isAvailable: true,
                deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro",
                lastBootedAt: "2026-06-04T15:13:08Z",
            },
            {
                udid: "0B97AADA-30AB-47D0-BFB9-1981BB82A837",
                name: "iPhone 16 Pro Max",
                state: "Shutdown",
                isAvailable: true,
                deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro-Max",
            },
        ],
    },
});
// ─── Tests ────────────────────────────────────────────────────────────────────
describe("simctl helpers", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });
    it("listDevices parses simctl JSON into flat SimDevice array", async () => {
        vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 0,
            stdout: SAMPLE_SIMCTL_JSON,
            stderr: "",
        });
        const result = await simctl.listDevices();
        expect(result.ok).toBe(true);
        expect(result.devices).toHaveLength(2);
        const booted = result.devices.find((d) => d.udid === "74DD7D29-38BC-4B82-B92A-FFA7E0C15F74");
        expect(booted).toBeDefined();
        expect(booted?.state).toBe("Booted");
        expect(booted?.name).toBe("iPhone 16 Pro");
        expect(booted?.runtime).toBe("com.apple.CoreSimulator.SimRuntime.iOS-18-5");
    });
    it("listDevices returns ok:false on simctl failure", async () => {
        vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 1,
            stdout: "",
            stderr: "xcrun: error: unable to find utility",
        });
        const result = await simctl.listDevices();
        expect(result.ok).toBe(false);
        expect(result.devices).toHaveLength(0);
        expect(result.error).toContain("xcrun");
    });
    it("setLocation builds correct xcrun simctl location <udid> set <lat>,<lon> args", async () => {
        const spy = vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 0,
            stdout: "",
            stderr: "",
        });
        await simctl.setLocation("SOME-UDID", 30.2672, -97.7431);
        expect(spy).toHaveBeenCalledOnce();
        const [cmd, args] = spy.mock.calls[0];
        expect(cmd).toBe("xcrun");
        expect(args).toEqual(["simctl", "location", "SOME-UDID", "set", "30.2672,-97.7431"]);
    });
});
describe("device tools via fake server", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });
    async function buildServer() {
        // Dynamic import so vi.mock hoisting can intercept exec & simctl before registration
        const { registerDeviceTools } = await import("./device.js");
        const fake = makeFakeServer();
        // Cast is safe: fake implements the minimal interface registerDeviceTools uses
        registerDeviceTools(fake);
        return fake;
    }
    it("device_list merges iOS devices and reports android absent when adb is missing", async () => {
        vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 0,
            stdout: SAMPLE_SIMCTL_JSON,
            stderr: "",
        });
        vi.spyOn(exec, "commandExists").mockResolvedValueOnce(false);
        const fake = await buildServer();
        const handler = fake._handlers.get("device_list");
        expect(handler).toBeDefined();
        const response = await handler({});
        expect(response.isError).toBeUndefined();
        const payload = JSON.parse(response.content[0].text);
        expect(payload.ios).toHaveLength(2);
        expect(payload.ios[0].state).toBe("Booted");
        expect(payload.android.available).toBe(false);
        expect(payload.android.reason).toBe("adb not found");
    });
    it("device_list returns isError when simctl fails", async () => {
        vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 1,
            stdout: "",
            stderr: "simctl unavailable",
        });
        vi.spyOn(exec, "commandExists").mockResolvedValueOnce(false);
        const fake = await buildServer();
        const handler = fake._handlers.get("device_list");
        const response = await handler({});
        expect(response.isError).toBe(true);
        expect(response.content[0].text).toContain("simctl list failed");
    });
    it("set_location builds correct command args through the tool handler", async () => {
        const spy = vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 0,
            stdout: "",
            stderr: "",
        });
        const fake = await buildServer();
        const handler = fake._handlers.get("set_location");
        expect(handler).toBeDefined();
        const response = await handler({
            udid: "74DD7D29-38BC-4B82-B92A-FFA7E0C15F74",
            latitude: 30.2672,
            longitude: -97.7431,
        });
        expect(response.isError).toBeUndefined();
        expect(spy).toHaveBeenCalledOnce();
        const [cmd, args] = spy.mock.calls[0];
        expect(cmd).toBe("xcrun");
        expect(args).toEqual([
            "simctl",
            "location",
            "74DD7D29-38BC-4B82-B92A-FFA7E0C15F74",
            "set",
            "30.2672,-97.7431",
        ]);
    });
    it("device_boot returns isError without throwing on failure", async () => {
        vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 2,
            stdout: "",
            stderr: "Device not found",
        });
        const fake = await buildServer();
        const handler = fake._handlers.get("device_boot");
        const response = await handler({ udid: "NONEXISTENT-UDID" });
        expect(response.isError).toBe(true);
        expect(response.content[0].text).toContain("boot failed");
        expect(response.content[0].text).toContain("Device not found");
    });
    it("screenshot defaults to a tmp path and returns path + byteSize", async () => {
        vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 0,
            stdout: "",
            stderr: "",
        });
        const fake = await buildServer();
        const handler = fake._handlers.get("screenshot");
        const response = await handler({ udid: "74DD7D29-38BC-4B82-B92A-FFA7E0C15F74" });
        // isError should NOT be set on success
        expect(response.isError).toBeUndefined();
        const payload = JSON.parse(response.content[0].text);
        expect(payload.ok).toBe(true);
        expect(payload.path).toMatch(/\.png$/);
        // byteSize may be null if the tmp file wasn't actually written (mocked run)
        expect(payload.byteSize === null || typeof payload.byteSize === "number").toBe(true);
    });
    it("app_list: parses listApps result (mocked run for simctl + plutil)", async () => {
        const plistJson = JSON.stringify({
            "com.playstudios.thewinzone": {
                CFBundleDisplayName: "The Win Zone",
                ApplicationType: "User",
            },
            "com.apple.mobilesafari": {
                CFBundleName: "Safari",
                ApplicationType: "System",
            },
        });
        vi.spyOn(exec, "run").mockImplementation(async (cmd, args) => {
            if (cmd === "xcrun" && args[1] === "listapps") {
                return { code: 0, stdout: "FAKE_PLIST_OUTPUT", stderr: "" };
            }
            if (cmd === "plutil") {
                return { code: 0, stdout: plistJson, stderr: "" };
            }
            return { code: 1, stdout: "", stderr: "unexpected" };
        });
        const fake = await buildServer();
        const handler = fake._handlers.get("app_list");
        expect(handler).toBeDefined();
        const response = await handler({ udid: "74DD7D29" });
        expect(response.isError).toBeUndefined();
        const payload = JSON.parse(response.content[0].text);
        expect(payload.count).toBe(2);
        const winzone = payload.apps.find((a) => a.bundleId === "com.playstudios.thewinzone");
        expect(winzone).toBeDefined();
        expect(winzone?.name).toBe("The Win Zone");
        expect(winzone?.type).toBe("User");
    });
    it("app_list: returns isError on simctl failure", async () => {
        vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 1,
            stdout: "",
            stderr: "Device not found",
        });
        const fake = await buildServer();
        const handler = fake._handlers.get("app_list");
        const response = await handler({ udid: "BAD-UDID" });
        expect(response.isError).toBe(true);
        expect(response.content[0].text).toContain("app_list failed");
    });
    it("app_uninstall: passes correct xcrun args", async () => {
        const spy = vi.spyOn(exec, "run").mockResolvedValueOnce({
            code: 0,
            stdout: "",
            stderr: "",
        });
        const fake = await buildServer();
        const handler = fake._handlers.get("app_uninstall");
        const response = await handler({ udid: "74DD7D29", bundleId: "com.example.app" });
        expect(response.isError).toBeUndefined();
        const [cmd, args] = spy.mock.calls[0];
        expect(cmd).toBe("xcrun");
        expect(args).toEqual(["simctl", "uninstall", "74DD7D29", "com.example.app"]);
    });
    it("screen_size: parses sips output correctly", async () => {
        vi.spyOn(exec, "run").mockImplementation(async (cmd, args) => {
            // xcrun simctl io <udid> screenshot <tmpFile> — screenshot is args[3]
            if (cmd === "xcrun" && args[3] === "screenshot") {
                return { code: 0, stdout: "", stderr: "" };
            }
            if (cmd === "sips") {
                return {
                    code: 0,
                    stdout: "  pixelWidth: 1290\n  pixelHeight: 2796\n",
                    stderr: "",
                };
            }
            return { code: 1, stdout: "", stderr: "unexpected" };
        });
        const fake = await buildServer();
        const handler = fake._handlers.get("screen_size");
        const response = await handler({ udid: "74DD7D29" });
        expect(response.isError).toBeUndefined();
        const payload = JSON.parse(response.content[0].text);
        expect(payload.widthPx).toBe(1290);
        expect(payload.heightPx).toBe(2796);
    });
    it("orientation_get: returns portrait when height > width", async () => {
        vi.spyOn(exec, "run").mockImplementation(async (cmd, args) => {
            if (cmd === "xcrun" && args[3] === "screenshot") {
                return { code: 0, stdout: "", stderr: "" };
            }
            if (cmd === "sips") {
                return {
                    code: 0,
                    stdout: "  pixelWidth: 390\n  pixelHeight: 844\n",
                    stderr: "",
                };
            }
            return { code: 1, stdout: "", stderr: "unexpected" };
        });
        const fake = await buildServer();
        const handler = fake._handlers.get("orientation_get");
        const response = await handler({ udid: "74DD7D29" });
        expect(response.isError).toBeUndefined();
        const payload = JSON.parse(response.content[0].text);
        expect(payload.orientation).toBe("portrait");
    });
    it("orientation_get: returns landscape when width > height", async () => {
        vi.spyOn(exec, "run").mockImplementation(async (cmd, args) => {
            if (cmd === "xcrun" && args[3] === "screenshot") {
                return { code: 0, stdout: "", stderr: "" };
            }
            if (cmd === "sips") {
                return {
                    code: 0,
                    stdout: "  pixelWidth: 844\n  pixelHeight: 390\n",
                    stderr: "",
                };
            }
            return { code: 1, stdout: "", stderr: "unexpected" };
        });
        const fake = await buildServer();
        const handler = fake._handlers.get("orientation_get");
        const response = await handler({ udid: "74DD7D29" });
        expect(response.isError).toBeUndefined();
        const payload = JSON.parse(response.content[0].text);
        expect(payload.orientation).toBe("landscape");
    });
});
// ─── recording module tests ───────────────────────────────────────────────────
// ESM native modules (node:child_process) can't be spied on at runtime.
// We test the registry guard by calling startRecording/stopRecording directly.
// stopRecording polls up to 8 s for file stability, so tests carry a 15 s budget.
describe("recording module", () => {
    it("startRecording returns ok:true and a pid on first call", async () => {
        const udid = `recording-basic-${Date.now()}`;
        const savePath = `/tmp/podium-basic-${Date.now()}.mp4`;
        const first = await recording.startRecording(udid, savePath);
        expect(first.ok).toBe(true);
        expect(typeof first.pid).toBe("number");
        expect(first.path).toBe(savePath);
        // Stop so registry doesn't leak; stopRecording handles ESRCH if process already exited
        await recording.stopRecording(udid).catch(() => undefined);
    }, 15_000);
    it("second startRecording for same udid returns 'already active' without spawning again", async () => {
        const udid = `recording-guard-${Date.now()}`;
        const savePath = `/tmp/podium-guard-${Date.now()}.mp4`;
        const first = await recording.startRecording(udid, savePath);
        expect(first.ok).toBe(true);
        // Guard check — purely synchronous JS registry lookup, returns immediately
        const second = await recording.startRecording(udid, savePath);
        expect(second.ok).toBe(false);
        expect(second.error).toMatch(/already active/);
        // Clean up registry
        await recording.stopRecording(udid).catch(() => undefined);
    }, 15_000);
});

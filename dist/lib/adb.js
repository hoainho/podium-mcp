/**
 * Android lifecycle driver via `adb` (v0.3.0 story A1).
 *
 * All commands run through lib/exec.ts (execFile, explicit arg arrays — no
 * shell), matching podium's no-shell contract. Screenshots use
 * `screencap` to an on-device path followed by `adb pull`, NOT `exec-out
 * screencap` — our runner returns stdout as a UTF-8 string, which would corrupt
 * binary PNG bytes.
 *
 * Parse helpers (parseAdbDevices, parseWmSize) are pure and exported for unit
 * tests; the live `adb` calls are exercised on an emulator in CI (story A3).
 */
import { run } from "./exec.js";
const ADB = "adb";
function toResult(r) {
    return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr, code: r.code };
}
/**
 * Parse `adb devices -l` into DeviceTargets. The first line is the
 * "List of devices attached" header; daemon notices (`* daemon ...`) and blank
 * lines are skipped. `model:Pixel_8` → name "Pixel 8"; a serial containing ":"
 * (host:port) is a network/wifi transport.
 */
export function parseAdbDevices(stdout) {
    return stdout
        .split("\n")
        .slice(1)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("*"))
        .map((line) => {
        const parts = line.split(/\s+/);
        const serial = parts[0];
        const state = parts[1] ?? "unknown";
        const modelTok = parts.find((p) => p.startsWith("model:"));
        const name = modelTok ? modelTok.slice("model:".length).replace(/_/g, " ") : serial;
        const transport = serial.includes(":") ? "network" : "usb";
        return { udid: serial, platform: "android", name, state, transport };
    });
}
/**
 * Parse `adb shell wm size`. Output is "Physical size: 1080x2400" and, when a
 * test override is active, an additional "Override size: WxH" — the override is
 * the effective resolution, so it wins.
 */
export function parseWmSize(stdout) {
    const override = /Override size:\s*(\d+)x(\d+)/.exec(stdout);
    const physical = /Physical size:\s*(\d+)x(\d+)/.exec(stdout);
    const m = override ?? physical;
    if (!m)
        return null;
    return { widthPx: parseInt(m[1], 10), heightPx: parseInt(m[2], 10) };
}
/** List ready Android devices/emulators (state === "device"). */
export async function listAndroidTargets() {
    const r = await run(ADB, ["devices", "-l"]);
    if (r.code !== 0)
        return [];
    return parseAdbDevices(r.stdout).filter((d) => d.state === "device");
}
async function screenshotAndroid(serial, outPath) {
    const devicePath = "/sdcard/podium-screen.png";
    const cap = await run(ADB, ["-s", serial, "shell", "screencap", "-p", devicePath], {
        timeout: 20_000,
    });
    if (cap.code !== 0)
        return toResult(cap);
    const pull = await run(ADB, ["-s", serial, "pull", devicePath, outPath], { timeout: 20_000 });
    // Remove the on-device temp; result is irrelevant to the screenshot outcome.
    await run(ADB, ["-s", serial, "shell", "rm", "-f", devicePath], { timeout: 10_000 });
    return toResult(pull);
}
export const androidDriver = {
    platform: "android",
    list: listAndroidTargets,
    // Android devices/emulators are already running; there is no per-device boot.
    install: async (serial, apkPath) => toResult(await run(ADB, ["-s", serial, "install", "-r", apkPath], { timeout: 120_000 })),
    launch: async (serial, pkg) => toResult(await run(ADB, ["-s", serial, "shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"], { timeout: 30_000 })),
    terminate: async (serial, pkg) => toResult(await run(ADB, ["-s", serial, "shell", "am", "force-stop", pkg], { timeout: 15_000 })),
    screenshot: screenshotAndroid,
    async screenSize(serial) {
        const r = await run(ADB, ["-s", serial, "shell", "wm", "size"], { timeout: 15_000 });
        if (r.code !== 0)
            return null;
        return parseWmSize(r.stdout);
    },
};

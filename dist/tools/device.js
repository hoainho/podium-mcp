import { z } from "zod";
import os from "node:os";
import path from "node:path";
import { stat } from "node:fs/promises";
import { commandExists } from "../lib/exec.js";
import { run } from "../lib/exec.js";
import { listDevicesCached, boot, install, launch, terminate, screenshot, openUrl, setLocation, listApps, uninstall, measureScreen, } from "../lib/simctl.js";
import { startRecording, stopRecording } from "../lib/recording.js";
import { getBackend } from "../lib/native.js";
import { parseAdbDevices } from "../lib/adb.js";
import { errorResult, okResult } from "../lib/result.js";
/** adb presence rarely changes mid-session — probe once. */
let adbPresentCache;
export function registerDeviceTools(server) {
    // ─── device_list ────────────────────────────────────────────────────────────
    server.tool("device_list", "Returns a merged inventory of available iOS simulators (udid, name, state, runtime) plus any adb-detected Android devices. If adb is absent, the android section reports availability: false instead of failing. NOTE: Android entries are detection-only — podium's automation tools (tap/inspect/etc.) currently target iOS simulators.", {}, async () => {
        const [iosResult, adbPresent] = await Promise.all([
            listDevicesCached(),
            adbPresentCache !== undefined
                ? Promise.resolve(adbPresentCache)
                : commandExists("adb").then((v) => (adbPresentCache = v)),
        ]);
        if (!iosResult.ok) {
            return errorResult(`simctl list failed: ${iosResult.error ?? "unknown error"}`);
        }
        let androidSection;
        if (!adbPresent) {
            androidSection = { available: false, reason: "adb not found" };
        }
        else {
            const adbResult = await run("adb", ["devices", "-l"]);
            if (adbResult.code !== 0) {
                androidSection = { available: false, reason: adbResult.stderr || adbResult.stdout };
            }
            else {
                androidSection = { available: true, devices: parseAdbDevices(adbResult.stdout) };
            }
        }
        const ios = iosResult.devices.map((d) => ({ ...d, platform: "ios-sim" }));
        return okResult({ ios, android: androidSection });
    });
    // ─── device_boot ────────────────────────────────────────────────────────────
    server.tool("device_boot", "Boots an iOS simulator by UDID. Waits up to 30 seconds for the boot command to complete. Idempotent: booting an already-booted device returns ok with alreadyBooted:true.", { udid: z.string().describe("Simulator UDID (from device_list)") }, async ({ udid }) => {
        const result = await boot(udid);
        if (!result.ok) {
            const combined = `${result.stderr} ${result.stdout}`;
            // Booting an already-booted device is a no-op success (simctl code 149 /
            // "Unable to boot device in current state: Booted").
            if (/current state: Booted/i.test(combined) || /already booted/i.test(combined)) {
                return okResult({ ok: true, udid, alreadyBooted: true });
            }
            return errorResult(`boot failed (code ${result.code}): ${result.stderr || result.stdout}`);
        }
        return okResult({ ok: true, udid, stdout: result.stdout });
    });
    // ─── app_install ─────────────────────────────────────────────────────────────
    server.tool("app_install", "Installs an app on an iOS simulator. Accepts a path to a .app directory or a .zip archive.", {
        udid: z.string().describe("Simulator UDID"),
        path: z.string().describe("Path to the .app directory or .zip file to install"),
    }, async ({ udid, path: appPath }) => {
        const result = await install(udid, appPath);
        if (!result.ok) {
            return errorResult(`install failed (code ${result.code}): ${result.stderr || result.stdout}`);
        }
        return okResult({ ok: true, udid, path: appPath, stdout: result.stdout });
    });
    // ─── app_launch ──────────────────────────────────────────────────────────────
    server.tool("app_launch", "Launches an app on an iOS simulator by bundle ID.", {
        udid: z.string().describe("Simulator UDID"),
        bundleId: z.string().describe("App bundle identifier (e.g. com.example.MyApp)"),
    }, async ({ udid, bundleId }) => {
        const result = await launch(udid, bundleId);
        if (!result.ok) {
            return errorResult(`launch failed (code ${result.code}): ${result.stderr || result.stdout}`);
        }
        return okResult({ ok: true, udid, bundleId, stdout: result.stdout });
    });
    // ─── app_terminate ───────────────────────────────────────────────────────────
    server.tool("app_terminate", "Terminates a running app on an iOS simulator by bundle ID.", {
        udid: z.string().describe("Simulator UDID"),
        bundleId: z.string().describe("App bundle identifier"),
    }, async ({ udid, bundleId }) => {
        const result = await terminate(udid, bundleId);
        if (!result.ok) {
            return errorResult(`terminate failed (code ${result.code}): ${result.stderr || result.stdout}`);
        }
        return okResult({ ok: true, udid, bundleId, stdout: result.stdout });
    });
    // ─── screenshot ──────────────────────────────────────────────────────────────
    server.tool("screenshot", "Takes a screenshot of an iOS simulator. Returns the saved file path and byte size. Does NOT return base64 to keep payload small. saveTo defaults to a .png file in os.tmpdir().", {
        udid: z.string().describe("Simulator UDID"),
        saveTo: z
            .string()
            .regex(/\.(png|jpg)$/i, "saveTo must end with .png or .jpg")
            .optional()
            .describe("Destination file path (must end .png or .jpg). Defaults to a tmp file."),
    }, async ({ udid, saveTo }) => {
        const outPath = saveTo ?? path.join(os.tmpdir(), `podium-screenshot-${Date.now()}.png`);
        const result = await screenshot(udid, outPath);
        if (!result.ok) {
            return errorResult(`screenshot failed (code ${result.code}): ${result.stderr || result.stdout}`);
        }
        let byteSize = null;
        try {
            const info = await stat(outPath);
            byteSize = info.size;
        }
        catch {
            // non-fatal — file stat failure doesn't invalidate the screenshot
        }
        return okResult({ ok: true, udid, path: outPath, byteSize });
    });
    // ─── open_url ────────────────────────────────────────────────────────────────
    server.tool("open_url", "Opens a URL on an iOS simulator (deep-links, https:// etc.).", {
        udid: z.string().describe("Simulator UDID"),
        url: z.string().url().describe("URL to open on the simulator"),
    }, async ({ udid, url }) => {
        const result = await openUrl(udid, url);
        if (!result.ok) {
            return errorResult(`open_url failed (code ${result.code}): ${result.stderr || result.stdout}`);
        }
        return okResult({ ok: true, udid, url, stdout: result.stdout });
    });
    // ─── set_location ────────────────────────────────────────────────────────────
    server.tool("set_location", "Sets the simulated GPS location on a running iOS simulator. Codifies the QA geo-spinner fix: use this to unblock location-gated features during QA testing without moving the physical device.", {
        udid: z.string().describe("Simulator UDID"),
        latitude: z.number().min(-90).max(90).describe("Latitude in decimal degrees"),
        longitude: z.number().min(-180).max(180).describe("Longitude in decimal degrees"),
    }, async ({ udid, latitude, longitude }) => {
        const result = await setLocation(udid, latitude, longitude);
        if (!result.ok) {
            return errorResult(`set_location failed (code ${result.code}): ${result.stderr || result.stdout}`);
        }
        return okResult({ ok: true, udid, latitude, longitude, stdout: result.stdout });
    });
    // ─── app_list ─────────────────────────────────────────────────────────────────
    server.tool("app_list", "Returns the list of installed apps on a booted iOS simulator. Includes bundle ID, display name, and application type (User/System).", {
        udid: z.string().describe("Simulator UDID (from device_list)"),
    }, async ({ udid }) => {
        const result = await listApps(udid);
        if (!result.ok) {
            return errorResult(`app_list failed: ${result.error ?? "unknown error"}`);
        }
        return okResult({ count: result.apps.length, apps: result.apps });
    });
    // ─── app_uninstall ────────────────────────────────────────────────────────────
    server.tool("app_uninstall", "Uninstalls an app from an iOS simulator by bundle ID.", {
        udid: z.string().describe("Simulator UDID"),
        bundleId: z.string().describe("App bundle identifier to uninstall (e.g. com.example.MyApp)"),
    }, async ({ udid, bundleId }) => {
        const result = await uninstall(udid, bundleId);
        if (!result.ok) {
            return errorResult(`app_uninstall failed (code ${result.code}): ${result.stderr || result.stdout}`);
        }
        return okResult({ ok: true, udid, bundleId, stdout: result.stdout });
    });
    // ─── screen_size ──────────────────────────────────────────────────────────────
    server.tool("screen_size", "Returns the pixel dimensions of a booted iOS simulator screen by taking a temp screenshot and reading its pixel dimensions with sips.", {
        udid: z.string().describe("Simulator UDID"),
    }, async ({ udid }) => {
        const result = await measureScreen(udid);
        if (!result.ok) {
            return errorResult(`screen_size failed: ${result.error ?? "unknown error"}`);
        }
        return okResult({ widthPx: result.widthPx, heightPx: result.heightPx });
    });
    // ─── orientation_get ──────────────────────────────────────────────────────────
    server.tool("orientation_get", "Returns the current orientation of a booted iOS simulator. Queries the native backend (mobilecli) when available for an exact answer; otherwise derives it from the screenshot aspect ratio.", {
        udid: z.string().describe("Simulator UDID"),
    }, async ({ udid }) => {
        // Native fast/exact path: mobilecli `device orientation get`.
        const be = await getBackend();
        if (be?.getOrientation) {
            const native = await be.getOrientation(udid);
            if (native) {
                return okResult({ orientation: native, basis: `${be.name} (native query)` });
            }
        }
        // Fallback: infer from screenshot aspect ratio.
        const result = await measureScreen(udid);
        if (!result.ok) {
            return errorResult(`orientation_get failed: ${result.error ?? "unknown error"}`);
        }
        const widthPx = result.widthPx;
        const heightPx = result.heightPx;
        const orientation = widthPx > heightPx ? "landscape" : "portrait";
        return okResult({
            orientation,
            widthPx,
            heightPx,
            basis: "screenshot-aspect-ratio (no native orientation query available)",
        });
    });
    // ─── record_start ─────────────────────────────────────────────────────────────
    server.tool("record_start", "Starts a screen recording on a booted iOS simulator. The recording runs in a detached background process. Call record_stop to finalize and retrieve the file.", {
        udid: z.string().describe("Simulator UDID"),
        saveTo: z
            .string()
            .regex(/\.mp4$/i, "saveTo must end with .mp4")
            .optional()
            .describe("Destination file path (must end .mp4). Defaults to a tmp file."),
    }, async ({ udid, saveTo }) => {
        // Timestamp the default path so a start→stop→start cycle never silently
        // overwrites the previous recording (a stale path would read the new file).
        const outPath = saveTo ?? path.join(os.tmpdir(), `podium-recording-${udid}-${Date.now()}.mp4`);
        const result = await startRecording(udid, outPath);
        if (!result.ok) {
            return errorResult(`record_start failed: ${result.error ?? "unknown error"}`);
        }
        return okResult({ ok: true, udid, path: result.path, pid: result.pid });
    });
    // ─── record_stop ──────────────────────────────────────────────────────────────
    server.tool("record_stop", "Stops the active screen recording for an iOS simulator. Sends SIGINT to flush the video file, waits for the file size to stabilize, and returns the path and size.", {
        udid: z.string().describe("Simulator UDID"),
    }, async ({ udid }) => {
        const result = await stopRecording(udid);
        if (!result.ok) {
            return errorResult(`record_stop failed: ${result.error ?? "unknown error"}`);
        }
        return okResult({ ok: true, udid, path: result.path, sizeBytes: result.sizeBytes });
    });
}

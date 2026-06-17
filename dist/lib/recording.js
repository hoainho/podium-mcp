import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
const registry = new Map();
/** Exposed for tests — returns the number of active recording entries. */
export function activeRecordings() {
    return registry.size;
}
/**
 * Starts a screen recording for the given simulator UDID.
 * Uses a detached child process so it outlives any timeout.
 * Returns an error if a recording is already active for the given UDID.
 */
export async function startRecording(udid, savePath) {
    if (registry.has(udid)) {
        return { ok: false, error: `recording already active for ${udid}` };
    }
    const child = spawn("xcrun", ["simctl", "io", udid, "recordVideo", "--codec=h264", "--force", savePath], { detached: true, stdio: "ignore" });
    if (child.pid === undefined) {
        return { ok: false, error: "failed to spawn recordVideo process — pid is undefined" };
    }
    child.unref();
    registry.set(udid, { pid: child.pid, path: savePath });
    return { ok: true, path: savePath, pid: child.pid };
}
/**
 * Stops the active recording for the given simulator UDID.
 * Sends SIGINT so xcrun simctl recordVideo flushes and finalizes the file.
 * Polls until the file size stabilizes (max ~8 s) before returning.
 */
export async function stopRecording(udid) {
    const entry = registry.get(udid);
    if (!entry) {
        return { ok: false, error: `no active recording for ${udid}` };
    }
    registry.delete(udid);
    try {
        process.kill(entry.pid, "SIGINT");
    }
    catch (e) {
        const err = e;
        if (err.code !== "ESRCH") {
            // ESRCH = process already gone — that is fine
            return { ok: false, error: `kill failed: ${String(e)}` };
        }
    }
    // Poll until file size stabilises across two consecutive 500 ms checks (max 8 s)
    const maxWaitMs = 8_000;
    const pollIntervalMs = 500;
    const deadline = Date.now() + maxWaitMs;
    let prevSize = -1;
    let stableCount = 0;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        let currentSize;
        try {
            const info = await stat(entry.path);
            currentSize = info.size;
        }
        catch {
            // File may not exist yet if the process died very quickly
            currentSize = 0;
        }
        if (currentSize === prevSize && currentSize > 0) {
            stableCount++;
            if (stableCount >= 2) {
                break;
            }
        }
        else {
            stableCount = 0;
        }
        prevSize = currentSize;
    }
    let finalSize = 0;
    try {
        const info = await stat(entry.path);
        finalSize = info.size;
    }
    catch {
        // non-fatal — report 0
    }
    return { ok: true, path: entry.path, sizeBytes: finalSize };
}

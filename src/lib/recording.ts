import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { run, commandExists } from "./exec.js";
import { resolvePlatform } from "./device-target.js";
import type { Platform } from "./device-target.js";

interface RecordingEntry {
  pid: number;
  path: string;
  platform: Platform;
  udid: string;
  /** android: on-device temp file pulled to `path` on stop. */
  devicePath?: string;
  /** Watchdog that SIGINTs the recorder after the max-duration cap; cleared on stop. */
  watchdog?: ReturnType<typeof setTimeout>;
}

const registry = new Map<string, RecordingEntry>();

/**
 * Hard cap on a single recording's duration. Without it, a record_start that is
 * never paired with record_stop (agent crash, forgotten flow) writes until the
 * disk fills. Override with PODIUM_MAX_RECORDING_MS; set to 0 to disable.
 */
function maxRecordingMs(): number {
  const raw = Number(process.env.PODIUM_MAX_RECORDING_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 600_000;
}

/** Exposed for tests — returns the number of active recording entries. */
export function activeRecordings(): number {
  return registry.size;
}

/**
 * The screen-recorder command per platform (pure — exported for tests):
 *   - ios-sim  → `xcrun simctl io <udid> recordVideo` (host-side file, SIGINT-stop)
 *   - ios-real → `idb record-video <path> --udid <udid>` (host-side file, SIGINT-stop)
 *   - android  → `adb -s <udid> shell screenrecord <devicePath>` (on-device file,
 *     pulled to the host on stop)
 */
export function recordingCommand(
  platform: Platform,
  udid: string,
  savePath: string,
  devicePath: string
): { cmd: string; args: string[] } {
  if (platform === "android") {
    return { cmd: "adb", args: ["-s", udid, "shell", "screenrecord", devicePath] };
  }
  if (platform === "ios-real") {
    return { cmd: "idb", args: ["record-video", savePath, "--udid", udid] };
  }
  return {
    cmd: "xcrun",
    args: ["simctl", "io", udid, "recordVideo", "--codec=h264", "--force", savePath],
  };
}

/**
 * Starts a screen recording for the given device (iOS sim/real or Android).
 * Uses a detached child process so it outlives any timeout.
 * Returns an error if a recording is already active for the given UDID, or if
 * the platform's recorder prerequisite (e.g. idb for real iOS) is missing.
 */
export async function startRecording(
  udid: string,
  savePath: string
): Promise<{ ok: boolean; path?: string; pid?: number; error?: string }> {
  if (registry.has(udid)) {
    return { ok: false, error: `recording already active for ${udid}` };
  }

  const platform = await resolvePlatform(udid);
  if (platform === "ios-real" && !(await commandExists("idb"))) {
    return {
      ok: false,
      error: "real-iOS recording needs idb (brew install facebook/fb/idb-companion)",
    };
  }
  const devicePath = `/sdcard/podium-rec-${Date.now()}.mp4`;
  const { cmd, args } = recordingCommand(platform, udid, savePath, devicePath);

  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });

  if (child.pid === undefined) {
    return { ok: false, error: `failed to spawn ${cmd} recorder — pid is undefined` };
  }

  child.unref();

  // Watchdog: finalize and drop the recording if record_stop is never called.
  const maxMs = maxRecordingMs();
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  if (maxMs > 0) {
    const pid = child.pid;
    watchdog = setTimeout(() => {
      try {
        process.kill(pid, "SIGINT");
      } catch {
        // already gone — nothing to stop
      }
      registry.delete(udid);
    }, maxMs);
    watchdog.unref();
  }

  registry.set(udid, {
    pid: child.pid,
    path: savePath,
    platform,
    udid,
    devicePath: platform === "android" ? devicePath : undefined,
    watchdog,
  });
  return { ok: true, path: savePath, pid: child.pid };
}

/**
 * Stops the active recording for the given UDID.
 * - iOS (sim/real): SIGINT the host recorder so it flushes and finalizes the file,
 *   then poll until the file size stabilizes.
 * - Android: SIGINT `screenrecord` on the device so the mp4 finalizes, then
 *   `adb pull` it to the host path.
 */
export async function stopRecording(
  udid: string
): Promise<{ ok: boolean; path?: string; sizeBytes?: number; error?: string }> {
  const entry = registry.get(udid);
  if (!entry) {
    return { ok: false, error: `no active recording for ${udid}` };
  }

  registry.delete(udid);
  if (entry.watchdog) clearTimeout(entry.watchdog);

  if (entry.platform === "android" && entry.devicePath) {
    // Stop screenrecord on-device (so the mp4 finalizes), then pull it to the host.
    await run("adb", ["-s", entry.udid, "shell", "pkill", "-INT", "screenrecord"], {
      timeout: 10_000,
    });
    try {
      process.kill(entry.pid, "SIGINT");
    } catch {
      // local adb process already exited — fine
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    const pull = await run("adb", ["-s", entry.udid, "pull", entry.devicePath, entry.path], {
      timeout: 60_000,
    });
    await run("adb", ["-s", entry.udid, "shell", "rm", "-f", entry.devicePath], { timeout: 10_000 });
    if (pull.code !== 0) {
      return { ok: false, error: `adb pull failed: ${pull.stderr || pull.stdout}` };
    }
    let size = 0;
    try {
      size = (await stat(entry.path)).size;
    } catch {
      // non-fatal — report 0
    }
    return { ok: true, path: entry.path, sizeBytes: size };
  }

  try {
    process.kill(entry.pid, "SIGINT");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
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
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
    let currentSize: number;
    try {
      const info = await stat(entry.path);
      currentSize = info.size;
    } catch {
      // File may not exist yet if the process died very quickly
      currentSize = 0;
    }
    if (currentSize === prevSize && currentSize > 0) {
      stableCount++;
      if (stableCount >= 2) {
        break;
      }
    } else {
      stableCount = 0;
    }
    prevSize = currentSize;
  }

  let finalSize = 0;
  try {
    const info = await stat(entry.path);
    finalSize = info.size;
  } catch {
    // non-fatal — report 0
  }

  return { ok: true, path: entry.path, sizeBytes: finalSize };
}

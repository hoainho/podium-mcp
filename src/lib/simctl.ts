import { run } from "./exec.js";
import type { RunResult } from "./exec.js";
import { writeFile, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";

export interface SimDevice {
  udid: string;
  name: string;
  state: string;
  runtime: string;
  isAvailable: boolean;
  deviceTypeIdentifier: string;
  lastBootedAt?: string;
}

export interface SimctlResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

function toResult(r: RunResult): SimctlResult {
  return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr, code: r.code };
}

const XCRUN = "xcrun";

/**
 * Returns all devices from `xcrun simctl list devices --json`.
 * Parses the nested runtime→device map into a flat array.
 */
export async function listDevices(): Promise<{ ok: boolean; devices: SimDevice[]; error?: string }> {
  const r = await run(XCRUN, ["simctl", "list", "devices", "--json"]);
  if (r.code !== 0) {
    return { ok: false, devices: [], error: r.stderr || r.stdout };
  }
  try {
    const parsed = JSON.parse(r.stdout) as {
      devices: Record<string, Array<{
        udid: string;
        name: string;
        state: string;
        isAvailable: boolean;
        deviceTypeIdentifier: string;
        lastBootedAt?: string;
      }>>;
    };
    const devices: SimDevice[] = [];
    for (const [runtime, entries] of Object.entries(parsed.devices)) {
      for (const d of entries) {
        devices.push({
          udid: d.udid,
          name: d.name,
          state: d.state,
          runtime,
          isAvailable: d.isAvailable,
          deviceTypeIdentifier: d.deviceTypeIdentifier,
          lastBootedAt: d.lastBootedAt,
        });
      }
    }
    return { ok: true, devices };
  } catch (e) {
    return { ok: false, devices: [], error: `JSON parse failed: ${String(e)}` };
  }
}

// ─── Device-list cache ───────────────────────────────────────────────────────

let deviceCache: { at: number; devices: SimDevice[] } | null = null;

/**
 * listDevices with a short TTL cache. Device boot states change rarely enough
 * that a 3 s window is safe, and it makes repeat calls (and the first call,
 * when prefetchDevices ran at server start) near-instant.
 */
export async function listDevicesCached(
  ttlMs = 3000
): Promise<{ ok: boolean; devices: SimDevice[]; error?: string }> {
  if (deviceCache && Date.now() - deviceCache.at < ttlMs) {
    return { ok: true, devices: deviceCache.devices };
  }
  const result = await listDevices();
  if (result.ok) {
    deviceCache = { at: Date.now(), devices: result.devices };
  }
  return result;
}

/** Fire-and-forget warm-up of the device-list cache (called at server start). */
export function prefetchDevices(): void {
  void listDevicesCached().catch(() => undefined);
}

/** Reset the device-list cache — exposed for tests. */
export function _resetDeviceCache(): void {
  deviceCache = null;
}

export async function boot(udid: string): Promise<SimctlResult> {
  return toResult(await run(XCRUN, ["simctl", "boot", udid], { timeout: 30_000 }));
}

export async function install(udid: string, appPath: string): Promise<SimctlResult> {
  return toResult(await run(XCRUN, ["simctl", "install", udid, appPath], { timeout: 60_000 }));
}

export async function launch(udid: string, bundleId: string): Promise<SimctlResult> {
  return toResult(await run(XCRUN, ["simctl", "launch", udid, bundleId]));
}

export async function terminate(udid: string, bundleId: string): Promise<SimctlResult> {
  return toResult(await run(XCRUN, ["simctl", "terminate", udid, bundleId]));
}

export async function screenshot(udid: string, outPath: string): Promise<SimctlResult> {
  return toResult(await run(XCRUN, ["simctl", "io", udid, "screenshot", outPath], { timeout: 15_000 }));
}

export async function openUrl(udid: string, url: string): Promise<SimctlResult> {
  return toResult(await run(XCRUN, ["simctl", "openurl", udid, url]));
}

/**
 * Sets the simulated GPS location on a running simulator.
 * Args are forwarded as `xcrun simctl location <udid> set <lat>,<lon>`.
 */
export async function setLocation(udid: string, lat: number, lon: number): Promise<SimctlResult> {
  return toResult(await run(XCRUN, ["simctl", "location", udid, "set", `${lat},${lon}`]));
}

export interface AppInfo {
  bundleId: string;
  name: string;
  type: string;
}

/**
 * Returns the list of installed apps on a booted simulator.
 * Uses xcrun simctl listapps + plutil to convert plist → JSON.
 * Writes simctl output to a temp file because plutil doesn't read stdin reliably.
 */
export async function listApps(
  udid: string
): Promise<{ ok: boolean; apps: AppInfo[]; error?: string }> {
  const tmpFile = join(os.tmpdir(), `podium-listapps-${Date.now()}.plist`);
  try {
    const r = await run(XCRUN, ["simctl", "listapps", udid], { timeout: 15_000 });
    if (r.code !== 0) {
      return { ok: false, apps: [], error: r.stderr || r.stdout };
    }
    await writeFile(tmpFile, r.stdout, "utf8");
    const plutil = await run("plutil", ["-convert", "json", "-o", "-", "--", tmpFile], {
      timeout: 10_000,
    });
    if (plutil.code !== 0) {
      return { ok: false, apps: [], error: plutil.stderr || plutil.stdout };
    }
    const parsed = JSON.parse(plutil.stdout) as Record<
      string,
      { CFBundleDisplayName?: string; CFBundleName?: string; ApplicationType?: string }
    >;
    const apps: AppInfo[] = Object.entries(parsed).map(([bundleId, entry]) => ({
      bundleId,
      name: entry.CFBundleDisplayName ?? entry.CFBundleName ?? bundleId,
      type: entry.ApplicationType ?? "Unknown",
    }));
    return { ok: true, apps };
  } catch (e) {
    return { ok: false, apps: [], error: String(e) };
  } finally {
    await unlink(tmpFile).catch(() => undefined);
  }
}

/**
 * Uninstalls an app from a simulator by bundle ID.
 */
export async function uninstall(udid: string, bundleId: string): Promise<SimctlResult> {
  return toResult(await run(XCRUN, ["simctl", "uninstall", udid, bundleId], { timeout: 30_000 }));
}

/**
 * Measures the pixel dimensions of the simulator screen by taking a temp screenshot
 * and inspecting it with `sips`.
 */
export async function measureScreen(
  udid: string
): Promise<{ ok: boolean; widthPx?: number; heightPx?: number; error?: string }> {
  const tmpFile = join(os.tmpdir(), `podium-measure-${Date.now()}.png`);
  try {
    const ssResult = await run(XCRUN, ["simctl", "io", udid, "screenshot", tmpFile], {
      timeout: 15_000,
    });
    if (ssResult.code !== 0) {
      return { ok: false, error: ssResult.stderr || ssResult.stdout };
    }
    const sipsResult = await run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", tmpFile], {
      timeout: 10_000,
    });
    if (sipsResult.code !== 0) {
      return { ok: false, error: sipsResult.stderr || sipsResult.stdout };
    }
    const widthMatch = /pixelWidth:\s*(\d+)/.exec(sipsResult.stdout);
    const heightMatch = /pixelHeight:\s*(\d+)/.exec(sipsResult.stdout);
    if (!widthMatch || !heightMatch) {
      return { ok: false, error: `sips output unparseable: ${sipsResult.stdout}` };
    }
    return {
      ok: true,
      widthPx: parseInt(widthMatch[1], 10),
      heightPx: parseInt(heightMatch[1], 10),
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    await unlink(tmpFile).catch(() => undefined);
  }
}

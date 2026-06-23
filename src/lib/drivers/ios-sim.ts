/**
 * iOS-Simulator PlatformDriver (v0.3.0 story M0b).
 *
 * Wraps the existing simctl.ts lifecycle functions behind the PlatformDriver
 * contract so device lifecycle is selected via the driver registry instead of
 * being hard-wired to `xcrun simctl` at every call site. Behavior is identical
 * to v0.2.0 — this is a thin adapter, not a reimplementation.
 *
 * SimctlResult ({ok, stdout, stderr, code}) structurally satisfies DriverResult,
 * so lifecycle methods delegate directly.
 */
import type { PlatformDriver, DeviceTarget } from "../device-target.js";
import {
  listDevicesCached,
  boot,
  install,
  launch,
  terminate,
  screenshot,
  measureScreen,
} from "../simctl.js";

export const iosSimDriver: PlatformDriver = {
  platform: "ios-sim",

  async list(): Promise<DeviceTarget[]> {
    const r = await listDevicesCached();
    if (!r.ok) return [];
    return r.devices.map((d) => ({
      udid: d.udid,
      platform: "ios-sim" as const,
      name: d.name,
      state: d.state,
      transport: "simulator" as const,
    }));
  },

  boot: (udid) => boot(udid),
  install: (udid, appPath) => install(udid, appPath),
  launch: (udid, bundleId) => launch(udid, bundleId),
  terminate: (udid, bundleId) => terminate(udid, bundleId),
  screenshot: (udid, outPath) => screenshot(udid, outPath),

  async screenSize(udid) {
    const r = await measureScreen(udid);
    if (!r.ok || r.widthPx == null || r.heightPx == null) return null;
    return { widthPx: r.widthPx, heightPx: r.heightPx };
  },
};

/**
 * Device-target abstraction (v0.3.0 foundation — story M0).
 *
 * v0.2.0 was iOS-Simulator-only: every tool took a bare `udid: string` and
 * called `xcrun simctl` directly. v0.3.0 must reach real iOS devices and
 * Android (emulator + real), which have different lifecycle mechanics. This
 * module introduces a platform-tagged device identity (`DeviceTarget`) and a
 * `PlatformDriver` registry so lifecycle operations are selected per platform
 * instead of being hard-wired to simctl.
 *
 * This file is intentionally pure (no `exec`, no I/O) so it is trivially
 * unit-testable and carries zero risk to the existing iOS-sim path. Concrete
 * drivers (ios-sim wraps simctl.ts; android wraps adb; ios-real wraps
 * go-ios/WDA) register themselves at startup via `registerDriver`.
 */

export type Platform = "ios-sim" | "ios-real" | "android";

export type Transport = "simulator" | "usb" | "network";

export interface DeviceTarget {
  /** Simulator UDID, real-iPhone UDID, or Android serial. */
  udid: string;
  platform: Platform;
  /** Human label (device/model name) when known. */
  name?: string;
  /** Boot/connection state as reported by the driver (e.g. "Booted", "device"). */
  state?: string;
  /** How podium reaches the device. */
  transport?: Transport;
}

/** Minimal result shape shared by driver lifecycle calls (decoupled from SimctlResult). */
export interface DriverResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  code?: number;
  error?: string;
}

/**
 * Lifecycle contract a platform driver provides. Gesture/inspect stay in the
 * `NativeBackend` abstraction (native.ts) — this interface is device lifecycle
 * only (the part currently hard-wired to simctl). `boot` is optional because
 * real devices are already powered on; only simulators boot.
 */
export interface PlatformDriver {
  platform: Platform;
  list(): Promise<DeviceTarget[]>;
  boot?(udid: string): Promise<DriverResult>;
  install(udid: string, appPath: string): Promise<DriverResult>;
  launch(udid: string, bundleId: string): Promise<DriverResult>;
  terminate(udid: string, bundleId: string): Promise<DriverResult>;
  screenshot(udid: string, outPath: string): Promise<DriverResult>;
  screenSize(udid: string): Promise<{ widthPx: number; heightPx: number } | null>;
}

// ─── Driver registry ──────────────────────────────────────────────────────────

const drivers = new Map<Platform, PlatformDriver>();

/** Register (or replace) the driver for a platform. Called once per driver at startup. */
export function registerDriver(driver: PlatformDriver): void {
  drivers.set(driver.platform, driver);
}

/** Look up the driver for a platform, or undefined if none is registered. */
export function getDriver(platform: Platform): PlatformDriver | undefined {
  return drivers.get(platform);
}

/** Platforms with a registered driver. */
export function registeredPlatforms(): Platform[] {
  return [...drivers.keys()];
}

/** Reset the registry — exposed for tests. */
export function _resetDrivers(): void {
  drivers.clear();
}

/**
 * Enumerate every device across all registered drivers. A driver that throws
 * is skipped (its platform contributes no devices) rather than failing the
 * whole inventory — matching the v0.2.0 "degrade, don't fail" contract.
 */
export async function listAllTargets(): Promise<DeviceTarget[]> {
  const out: DeviceTarget[] = [];
  for (const driver of drivers.values()) {
    try {
      out.push(...(await driver.list()));
    } catch {
      // degrade: a failing platform contributes nothing, never aborts the list
    }
  }
  return out;
}

// ─── Platform detection (fallback) ──────────────────────────────────────────────

const IOS_SIM_UUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
const IOS_REAL_40HEX = /^[0-9a-fA-F]{40}$/; // pre-A12 real iPhone UDID
const IOS_REAL_NEW = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}$/; // A12+ real iPhone UDID (8-16, single dash)

/**
 * Best-effort platform classification from a bare identifier, for the
 * transitional period while tools still take `udid: string` rather than a
 * resolved `DeviceTarget`. Authoritative platform comes from `device_list`
 * enumeration (each driver tags its own devices); this is the fallback when a
 * tool is handed only a raw id.
 *
 * Heuristics (best-effort only — prefer resolvePlatform() when correctness matters):
 *   - 8-4-4-4-12 hex UUID → "ios-sim". ⚠️ A CoreDevice (Xcode 15+) real-iPhone
 *     identifier has the SAME UUID format, so this CANNOT distinguish a real
 *     device from a simulator — verified on hardware (iPhone 12 Pro Max →
 *     E4EFAC0A-3C30-5424-9217-309584C18D2C). Only the enumerating driver knows.
 *   - 40-hex / 8-16 hex   → "ios-real" (older, pre-CoreDevice real-iPhone UDIDs)
 *   - anything else (adb serial like emulator-5554, R5CT…) → "android"
 */
export function detectPlatform(udid: string): Platform {
  const id = udid.trim();
  if (IOS_SIM_UUID.test(id)) return "ios-sim";
  if (IOS_REAL_40HEX.test(id) || IOS_REAL_NEW.test(id)) return "ios-real";
  return "android";
}

/**
 * Authoritative platform for a device id: consult the live, driver-tagged
 * inventory first (device_list). A simulator and a real device can share an
 * identical CoreDevice UUID, so format alone cannot tell them apart — only the
 * enumerating driver does. Falls back to the detectPlatform heuristic when the
 * device isn't currently listed (offline, or no drivers registered).
 */
export async function resolvePlatform(udid: string): Promise<Platform> {
  const id = udid.trim();
  const target = (await listAllTargets()).find((t) => t.udid === id);
  return target ? target.platform : detectPlatform(id);
}

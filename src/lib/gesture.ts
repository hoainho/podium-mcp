/**
 * Hybrid native-gesture layer.
 *
 * Raw coordinate gestures are delivered through the best available backend:
 *   1. idb (`idb ui tap`)         — native, sub-second, no app context needed
 *   2. Maestro (`tapOn: point`)   — fallback when idb is absent
 *
 * The previous implementation shelled out to `xcrun simctl io <udid> touch`,
 * which is NOT a real simctl operation (only enumerate/poll/recordVideo/
 * screenshot exist) — so it silently failed with exit 117 on every call.
 * This layer replaces that phantom backend with backends that actually work.
 */
import { run } from "./exec.js";
import { getBackend } from "./native.js";
import { runMaestroFlow } from "./maestro.js";

export interface NativeTapResult {
  ok: boolean;
  backend: "idb" | "mobilecli" | "maestro";
  detail: string;
}

/**
 * Best-effort discovery of a running foreground app's bundle id, used as the
 * `appId` header for the Maestro fallback flow (Maestro requires one even when
 * the flow does not launch the app). Returns null when none can be found.
 */
export async function resolveForegroundApp(udid: string): Promise<string | null> {
  const r = await run("xcrun", ["simctl", "spawn", udid, "launchctl", "list"], {
    timeout: 10_000,
  });
  if (r.code !== 0) return null;
  // Labels look like: UIKitApplication:com.example.App[0x1234][rb-legacy]
  const match = /UIKitApplication:([A-Za-z0-9_.-]+)/.exec(r.stdout);
  return match ? match[1] : null;
}

/**
 * Tap an absolute logical-point coordinate via the best available backend.
 * `bundleId` is only consulted for the Maestro fallback; when omitted there,
 * the foreground app is auto-detected. idb needs no bundleId at all.
 */
export async function nativeTap(
  udid: string,
  x: number,
  y: number,
  opts?: { bundleId?: string }
): Promise<NativeTapResult> {
  const be = await getBackend();
  if (be) {
    const r = await be.tap(udid, x, y);
    if (r.code === 0) {
      return { ok: true, backend: be.name, detail: r.stdout || "tapped" };
    }
    // backend tap failed — fall through to the Maestro fallback below
  }

  // Maestro fallback — needs an appId header.
  const appId = opts?.bundleId ?? (await resolveForegroundApp(udid));
  if (!appId) {
    return {
      ok: false,
      backend: "maestro",
      detail:
        "no tap backend available: neither idb nor mobilecli resolved, and no " +
        "foreground app could be detected for the Maestro fallback. Run " +
        "`npm install` in podium-mcp (bundles mobilecli) or pass a bundleId.",
    };
  }

  const yaml = [`appId: ${appId}`, `---`, `- tapOn:`, `    point: "${x},${y}"`].join("\n");
  try {
    const res = await runMaestroFlow({ udid, yaml, timeoutMs: 30_000 });
    return {
      ok: res.passed,
      backend: "maestro",
      detail: res.passed ? `tapped via ${appId}` : res.rawOutput,
    };
  } catch (err) {
    return { ok: false, backend: "maestro", detail: String(err) };
  }
}

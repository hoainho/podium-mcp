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
import { getBackend, findElements, elementCenter } from "./native.js";
import type { NativeBackend } from "./native.js";
import { runMaestroFlow } from "./maestro.js";

export interface NativeTapResult {
  ok: boolean;
  backend: NativeBackend["name"] | "maestro";
  detail: string;
}

/**
 * Normalized result for the shared native-then-Maestro gesture executors below.
 * Both the discrete screen.ts tools and the run_steps batch executor consume
 * these, so the native→Maestro fallback ladder lives in exactly one place.
 */
export interface GestureResult {
  ok: boolean;
  /** "idb" | "mobilecli" | "maestro" | "<native>+maestro" (composite for typed+submit). */
  backend: string;
  /** Human/agent-facing detail or raw Maestro output on failure. */
  detail?: string;
  /** Whether Enter was pressed after typing (input_text/type only). */
  submit?: boolean;
  /** Resolved swipe points when the native path ran. */
  points?: { x1: number; y1: number; x2: number; y2: number };
  /** Resolved tap point when tap-by-text resolved natively. */
  tappedAt?: { x: number; y: number };
  /** The Maestro selector used, when the Maestro path ran (tap-by-text). */
  selector?: string;
}

export type SwipeDirection = "up" | "down" | "left" | "right";

/** Per-action options shared by the executors. `launchApp` prepends a Maestro
 *  `launchApp: { stopApp: false }` attach step (the discrete screen.ts tools set
 *  this from their `noLaunch` flag; run_steps never launches). */
interface GestureOpts {
  bundleId?: string;
  timeoutMs?: number;
  launchApp?: boolean;
}

/** Capitalize first letter for Maestro YAML ("enter" → "Enter"); Maestro matches case-insensitively. */
function fmtMaestroKey(k: string): string {
  return k.charAt(0).toUpperCase() + k.slice(1);
}

/** Parse "35%" against a span, or a plain number string verbatim. Null on junk. */
function resolveCoord(raw: string, span: number): number | null {
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(raw.trim());
  if (pct) return (parseFloat(pct[1]) / 100) * span;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}

/** appId for a Maestro fallback: explicit bundleId, else the foreground app. */
async function appIdFor(udid: string, bundleId?: string): Promise<string | null> {
  return bundleId ?? (await resolveForegroundApp(udid));
}

/** Build the Maestro flow header lines (appId + optional launchApp attach). */
function flowHeader(appId: string, launchApp?: boolean): string[] {
  return [`appId: ${appId}`, `---`, ...(launchApp ? [`- launchApp:`, `    stopApp: false`] : [])];
}

/**
 * Press a hardware/system key: native mapping when available, else a Maestro
 * `pressKey` flow. Shared by the press_key tool and run_steps `key`.
 */
export async function nativeKey(
  udid: string,
  key: string,
  opts?: GestureOpts
): Promise<GestureResult> {
  const be = await getBackend();
  if (be && be.canPressKey(key)) {
    const r = await be.pressKey(udid, key);
    if (r && r.code === 0) return { ok: true, backend: be.name };
  }
  const appId = await appIdFor(udid, opts?.bundleId);
  if (!appId) {
    return { ok: false, backend: "maestro", detail: "no native mapping and no appId for Maestro fallback" };
  }
  const yaml = [...flowHeader(appId, opts?.launchApp), `- pressKey: ${JSON.stringify(fmtMaestroKey(key))}`].join("\n");
  const m = await runMaestroFlow({ udid, yaml, timeoutMs: opts?.timeoutMs ?? 15_000 });
  return m.passed
    ? { ok: true, backend: "maestro" }
    : { ok: false, backend: "maestro", detail: m.rawOutput.slice(0, 200) };
}

/**
 * Type into the focused field (optionally pressing Enter): native inputText
 * when available, with a Maestro fallback for typing and for the Enter press.
 * Shared by the input_text tool and run_steps `type`.
 */
export async function nativeInputText(
  udid: string,
  text: string,
  opts?: GestureOpts & { submit?: boolean }
): Promise<GestureResult> {
  const submit = opts?.submit ?? false;
  const be = await getBackend();
  if (be) {
    const r = await be.inputText(udid, text);
    if (r.code === 0) {
      if (!submit) return { ok: true, backend: be.name, submit: false };
      // Typed natively; try to submit natively first.
      if (be.canPressKey("enter")) {
        const k = await be.pressKey(udid, "enter");
        if (k && k.code === 0) return { ok: true, backend: be.name, submit: true };
      }
      // Text is already typed — re-typing via Maestro would duplicate it, so
      // only send a Maestro pressKey for the Enter when an appId is available.
      const appId = await appIdFor(udid, opts?.bundleId);
      if (appId) {
        const m = await runMaestroFlow({
          udid,
          yaml: `appId: ${appId}\n---\n- pressKey: "Enter"`,
          timeoutMs: opts?.timeoutMs ?? 15_000,
        });
        return { ok: m.passed, backend: `${be.name}+maestro`, submit: true };
      }
      return {
        ok: true,
        backend: be.name,
        submit: false,
        detail: "typed; Enter skipped (no native mapping and no appId)",
      };
    }
    // native input failed — fall through to the Maestro type path
  }

  const appId = await appIdFor(udid, opts?.bundleId);
  if (!appId) {
    return { ok: false, backend: "maestro", detail: "native inputText unavailable and no appId for Maestro fallback" };
  }
  const lines = [...flowHeader(appId, opts?.launchApp), `- inputText: ${JSON.stringify(text)}`];
  if (submit) lines.push(`- pressKey: "Enter"`);
  const m = await runMaestroFlow({ udid, yaml: lines.join("\n"), timeoutMs: opts?.timeoutMs ?? 30_000 });
  return m.passed
    ? { ok: true, backend: "maestro", submit }
    : { ok: false, backend: "maestro", submit, detail: m.rawOutput.slice(0, 200) };
}

/**
 * Swipe by direction (default) or explicit coordinates: native swipe when a
 * backend + screen dimensions are available, else a Maestro `swipe` flow.
 *
 * `points` are pre-resolved absolute logical points (run_steps). `overrides`
 * are percent-or-pixel strings (the swipe tool); they resolve to points for the
 * native path and pass through verbatim (percent-friendly) for the Maestro path.
 * Shared by the swipe tool and run_steps `swipe`.
 */
export async function nativeSwipe(
  udid: string,
  spec: {
    direction?: SwipeDirection;
    points?: { x1: number; y1: number; x2: number; y2: number };
    overrides?: { startX: string; startY: string; endX: string; endY: string };
  },
  opts?: GestureOpts
): Promise<GestureResult> {
  const be = await getBackend();
  if (be) {
    const dims = await be.screenPoints(udid);
    if (dims) {
      let pts = spec.points ?? null;
      if (!pts && spec.overrides) {
        const x1 = resolveCoord(spec.overrides.startX, dims.w);
        const y1 = resolveCoord(spec.overrides.startY, dims.h);
        const x2 = resolveCoord(spec.overrides.endX, dims.w);
        const y2 = resolveCoord(spec.overrides.endY, dims.h);
        if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) pts = { x1, y1, x2, y2 };
      }
      if (!pts) {
        const dir = spec.direction ?? "up";
        const cx = dims.w / 2;
        const cy = dims.h / 2;
        pts =
          dir === "up"
            ? { x1: cx, y1: dims.h * 0.7, x2: cx, y2: dims.h * 0.3 }
            : dir === "down"
              ? { x1: cx, y1: dims.h * 0.3, x2: cx, y2: dims.h * 0.7 }
              : dir === "left"
                ? { x1: dims.w * 0.8, y1: cy, x2: dims.w * 0.2, y2: cy }
                : { x1: dims.w * 0.2, y1: cy, x2: dims.w * 0.8, y2: cy };
      }
      const r = await be.swipe(udid, pts.x1, pts.y1, pts.x2, pts.y2);
      if (r.code === 0) return { ok: true, backend: be.name, points: pts };
      // native swipe failed — fall through to Maestro
    }
  }

  const appId = await appIdFor(udid, opts?.bundleId);
  if (!appId) {
    return { ok: false, backend: "maestro", detail: "native swipe unavailable and no appId for Maestro fallback" };
  }
  const swipeLine = spec.overrides
    ? `- swipe:\n    start: "${spec.overrides.startX},${spec.overrides.startY}"\n    end: "${spec.overrides.endX},${spec.overrides.endY}"`
    : spec.points
      ? `- swipe:\n    start: "${spec.points.x1},${spec.points.y1}"\n    end: "${spec.points.x2},${spec.points.y2}"`
      : `- swipe:\n    direction: ${(spec.direction ?? "up").toUpperCase()}`;
  const yaml = [...flowHeader(appId, opts?.launchApp), swipeLine].join("\n");
  const m = await runMaestroFlow({ udid, yaml, timeoutMs: opts?.timeoutMs ?? 30_000 });
  return m.passed
    ? { ok: true, backend: "maestro" }
    : { ok: false, backend: "maestro", detail: m.rawOutput.slice(0, 200) };
}

/**
 * Tap a native accessibility element by text/id: resolve via the backend's
 * element tree and tap its center, else a Maestro `tapOn` selector flow.
 * Shared by run_steps `tapText`.
 */
export async function nativeTapText(
  udid: string,
  sel: { text?: string; id?: string; index?: number },
  opts?: GestureOpts
): Promise<GestureResult> {
  if (!sel.text && !sel.id) {
    return { ok: false, backend: "maestro", detail: "tapText requires text or id" };
  }
  const be = await getBackend();
  if (be) {
    const els = await be.describeAll(udid);
    if (els) {
      const match = findElements(els, { text: sel.text, id: sel.id })[sel.index ?? 0];
      const pt = match ? elementCenter(match) : null;
      if (pt) {
        const r = await be.tap(udid, pt.x, pt.y);
        if (r.code === 0) return { ok: true, backend: be.name, tappedAt: pt };
      }
    }
  }
  const appId = await appIdFor(udid, opts?.bundleId);
  if (!appId) {
    return {
      ok: false,
      backend: "maestro",
      detail:
        "element not found natively and no appId for Maestro fallback — pass bundleId or use a coordinate tap",
    };
  }
  const selector =
    sel.text && sel.id
      ? `{ text: ${JSON.stringify(sel.text)}, id: ${JSON.stringify(sel.id)}${sel.index !== undefined ? `, index: ${sel.index}` : ""} }`
      : sel.text
        ? sel.index !== undefined
          ? `{ text: ${JSON.stringify(sel.text)}, index: ${sel.index} }`
          : JSON.stringify(sel.text)
        : `{ id: ${JSON.stringify(sel.id!)} }`;
  const yaml = [...flowHeader(appId, opts?.launchApp), `- tapOn: ${selector}`].join("\n");
  const m = await runMaestroFlow({ udid, yaml, timeoutMs: opts?.timeoutMs ?? 30_000 });
  return m.passed
    ? { ok: true, backend: "maestro", selector }
    : { ok: false, backend: "maestro", selector, detail: m.rawOutput.slice(0, 200) };
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

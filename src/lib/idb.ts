/**
 * idb (Facebook iOS Development Bridge) native fast-path.
 *
 * idb talks to the simulator over a gRPC companion, giving sub-second,
 * JVM-free gestures and a flat accessibility tree — the same engine mobile-mcp
 * uses. It is OPTIONAL: every helper degrades gracefully and callers fall back
 * to Maestro when `idbAvailable()` is false.
 *
 * Install: `brew tap facebook/fb && brew install idb-companion && pipx install fb-idb`
 */
import { run, commandExists } from "./exec.js";
import type { RunResult } from "./exec.js";

/** Cached idb presence check: undefined = not yet probed. */
let cachedIdb: boolean | undefined;

/**
 * True only when BOTH the `idb` CLI and `idb_companion` resolve. The Python
 * client without the companion daemon fails on every device command, so a
 * client-only install must not be treated as a usable backend.
 */
export async function idbAvailable(): Promise<boolean> {
  if (cachedIdb !== undefined) return cachedIdb;
  const [cli, companion] = await Promise.all([
    commandExists("idb"),
    commandExists("idb_companion"),
  ]);
  cachedIdb = cli && companion;
  return cachedIdb;
}

/** Reset the cached probe — exposed for tests. */
export function _resetIdbCache(): void {
  cachedIdb = undefined;
}

/** Tap at an absolute logical-point coordinate. */
export function idbTap(udid: string, x: number, y: number): Promise<RunResult> {
  return run("idb", ["ui", "tap", "--udid", udid, String(x), String(y)], {
    timeout: 15_000,
  });
}

/** Swipe from one point to another (logical points). durationMs optional. */
export function idbSwipe(
  udid: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  durationMs?: number
): Promise<RunResult> {
  const args = ["ui", "swipe", "--udid", udid, String(startX), String(startY), String(endX), String(endY)];
  if (durationMs !== undefined) {
    args.push("--duration", String(durationMs / 1000));
  }
  return run("idb", args, { timeout: 20_000 });
}

/** Type text into the focused element (real keystroke injection). */
export function idbInputText(udid: string, text: string): Promise<RunResult> {
  return run("idb", ["ui", "text", "--udid", udid, text], { timeout: 15_000 });
}

/** Press a hardware/keyboard key by HID keycode. */
export function idbKey(udid: string, keycode: number): Promise<RunResult> {
  return run("idb", ["ui", "key", "--udid", udid, String(keycode)], {
    timeout: 10_000,
  });
}

/** One accessibility element as reported by `idb ui describe-all`. */
export interface IdbElement {
  AXLabel?: string;
  AXValue?: string;
  type?: string;
  frame?: { x: number; y: number; width: number; height: number };
  [k: string]: unknown;
}

/** Hardware buttons supported by `idb ui button`. */
const IDB_BUTTONS: Record<string, string> = {
  home: "HOME",
  lock: "LOCK",
};

/** HID keycodes for `idb ui key`. */
const IDB_KEYCODES: Record<string, number> = {
  enter: 40,
  backspace: 42,
  tab: 43,
};

/** True when idbPressKey(key) has a mapping (no side effects). */
export function idbCanPressKey(key: string): boolean {
  return IDB_BUTTONS[key] !== undefined || IDB_KEYCODES[key] !== undefined;
}

/**
 * Press a key via idb when it maps to a button or HID keycode.
 * Returns null when the key has no idb mapping (caller falls back to Maestro).
 */
export async function idbPressKey(udid: string, key: string): Promise<RunResult | null> {
  const button = IDB_BUTTONS[key];
  if (button) {
    return run("idb", ["ui", "button", "--udid", udid, button], { timeout: 10_000 });
  }
  const code = IDB_KEYCODES[key];
  if (code !== undefined) {
    return idbKey(udid, code);
  }
  return null;
}

/**
 * Returns the flat accessibility-element list via `idb ui describe-all`.
 * Each element carries AXLabel/AXValue/frame — already compact (no nesting),
 * which is why it is preferred over Maestro's deep `hierarchy` JSON.
 * Never throws; returns ok:false with the raw text on parse/command failure.
 */
export async function idbDescribeAll(
  udid: string
): Promise<{ ok: true; elements: IdbElement[] } | { ok: false; text: string }> {
  const r = await run("idb", ["ui", "describe-all", "--udid", udid], {
    timeout: 20_000,
  });
  if (r.code !== 0) {
    return { ok: false, text: r.stderr || r.stdout };
  }
  // idb emits either a JSON array or newline-delimited JSON objects.
  const trimmed = r.stdout.trim();
  try {
    const parsed = JSON.parse(trimmed) as IdbElement | IdbElement[];
    if (Array.isArray(parsed)) return { ok: true, elements: parsed };
    return { ok: true, elements: [parsed] };
  } catch {
    const elements: IdbElement[] = [];
    for (const line of trimmed.split("\n")) {
      const l = line.trim();
      if (!l) continue;
      try {
        elements.push(JSON.parse(l) as IdbElement);
      } catch {
        // skip non-JSON line
      }
    }
    if (elements.length > 0) return { ok: true, elements };
    return { ok: false, text: trimmed };
  }
}

/**
 * Native gesture/inspection backend abstraction.
 *
 * Preference order:
 *   1. idb        — Facebook iOS Development Bridge (when installed)
 *   2. mobilecli  — bundled npm dependency (prebuilt Go binary; the same
 *                   engine mobile-mcp uses). No JVM, no Xcode toolchain.
 *
 * When neither is usable, callers fall back to Maestro flows (correct but
 * slow: each flow boots a JVM). Backends are probed once and cached.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { access, constants } from "node:fs/promises";
import { run, commandExists } from "./exec.js";
import { idbAvailable, idbTap, idbSwipe, idbInputText, idbPressKey, idbCanPressKey, idbDescribeAll, } from "./idb.js";
/** Center point of an element frame, or null when the frame is unusable. */
export function elementCenter(el) {
    const f = el.frame;
    if (!f || typeof f.x !== "number" || typeof f.y !== "number" || !Number.isFinite(f.x) || !Number.isFinite(f.y))
        return null;
    if (!(f.width > 0) || !(f.height > 0))
        return null;
    return { x: f.x + f.width / 2, y: f.y + f.height / 2 };
}
/**
 * Find elements matching a text (Maestro semantics: full-string regex,
 * IGNORE_CASE, substring fallback on invalid regex) or an exact identifier.
 */
export function findElements(elements, sel) {
    const matches = [];
    let re = null;
    if (sel.text) {
        try {
            re = new RegExp(`^(?:${sel.text})$`, "i");
        }
        catch {
            re = null;
        }
    }
    for (const el of elements) {
        if (sel.id && (el.identifier ?? "") === sel.id) {
            matches.push(el);
            continue;
        }
        if (sel.text) {
            const label = el.label ?? "";
            const value = el.value ?? "";
            const hit = re
                ? re.test(label) || re.test(value)
                : label.toLowerCase().includes(sel.text.toLowerCase()) ||
                    value.toLowerCase().includes(sel.text.toLowerCase());
            if (hit)
                matches.push(el);
        }
    }
    return matches;
}
// ─── mobilecli binary resolution ─────────────────────────────────────────────
/** Map node platform/arch to mobilecli's binary naming. */
function mobilecliBinaryName() {
    const plat = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : process.platform === "win32" ? "windows" : null;
    const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : null;
    if (!plat || !arch)
        return null;
    return `mobilecli-${plat}-${arch}${plat === "windows" ? ".exe" : ""}`;
}
let cachedMobilecli;
/**
 * Resolve the mobilecli binary: env override → bundled npm dependency → PATH.
 * Cached after first call. Returns null when unavailable.
 */
export async function resolveMobilecli() {
    if (cachedMobilecli !== undefined)
        return cachedMobilecli;
    const override = process.env.PODIUM_MOBILECLI;
    if (override) {
        try {
            await access(override, constants.X_OK);
            cachedMobilecli = override;
            return override;
        }
        catch {
            // fall through
        }
    }
    // Bundled npm dependency (preferred: version-pinned, no global install)
    const binName = mobilecliBinaryName();
    if (binName) {
        try {
            const require = createRequire(import.meta.url);
            const pkgPath = require.resolve("mobilecli/package.json");
            const candidate = join(dirname(pkgPath), "bin", binName);
            await access(candidate, constants.X_OK);
            cachedMobilecli = candidate;
            return candidate;
        }
        catch {
            // dep not installed or binary missing — fall through
        }
    }
    // PATH
    if (await commandExists("mobilecli")) {
        cachedMobilecli = "mobilecli";
        return cachedMobilecli;
    }
    cachedMobilecli = null;
    return null;
}
/** Reset caches — exposed for tests. */
export function _resetNativeCache() {
    cachedMobilecli = undefined;
    cachedBackend = undefined;
    negativeProbeAt = 0;
    screenPointsCache.clear();
}
// ─── mobilecli backend ───────────────────────────────────────────────────────
/** Hardware buttons supported by `mobilecli io button` (case-insensitive). */
const MOBILECLI_BUTTONS = {
    home: "HOME",
    lock: "POWER",
    power: "POWER",
    "volume up": "VOLUME_UP",
    "volume down": "VOLUME_DOWN",
};
const screenPointsCache = new Map();
function makeMobilecliBackend(bin) {
    return {
        name: "mobilecli",
        tap: (udid, x, y) => run(bin, ["io", "tap", `${Math.round(x)},${Math.round(y)}`, "--device", udid], {
            timeout: 15_000,
        }),
        swipe: (udid, x1, y1, x2, y2) => run(bin, [
            "io",
            "swipe",
            `${Math.round(x1)},${Math.round(y1)},${Math.round(x2)},${Math.round(y2)}`,
            "--device",
            udid,
        ], { timeout: 20_000 }),
        inputText: (udid, text) => run(bin, ["io", "text", text, "--device", udid], { timeout: 15_000 }),
        canPressKey: (key) => MOBILECLI_BUTTONS[key] !== undefined,
        pressKey: async (udid, key) => {
            const button = MOBILECLI_BUTTONS[key];
            if (!button)
                return null;
            return run(bin, ["io", "button", button, "--device", udid], { timeout: 10_000 });
        },
        describeAll: async (udid) => {
            const r = await run(bin, ["dump", "ui", "--device", udid], { timeout: 20_000 });
            if (r.code !== 0)
                return null;
            try {
                const parsed = JSON.parse(r.stdout);
                const els = parsed.data?.elements;
                if (!Array.isArray(els))
                    return null;
                return els.map((e) => ({
                    label: e.label ?? e.placeholder ?? e.name ?? "",
                    ...(e.value ? { value: e.value } : {}),
                    ...(e.type ? { type: e.type } : {}),
                    ...(e.identifier ? { identifier: e.identifier } : {}),
                    ...(e.rect ? { frame: e.rect } : {}),
                }));
            }
            catch {
                return null;
            }
        },
        screenPoints: async (udid) => {
            const hit = screenPointsCache.get(udid);
            if (hit && Date.now() - hit.at < 10_000)
                return { w: hit.w, h: hit.h };
            const r = await run(bin, ["device", "info", "--device", udid], { timeout: 15_000 });
            if (r.code !== 0)
                return null;
            try {
                const parsed = JSON.parse(r.stdout);
                const s = parsed.data?.device?.screenSize;
                if (!s?.width || !s?.height)
                    return null;
                // screenSize is reported in pixels when scale is present; convert to points.
                const scale = s.scale && s.scale > 0 ? s.scale : 1;
                const dims = { w: s.width / scale, h: s.height / scale, at: Date.now() };
                screenPointsCache.set(udid, dims);
                return { w: dims.w, h: dims.h };
            }
            catch {
                return null;
            }
        },
        setOrientation: async (udid, value) => {
            const mapped = value === "PORTRAIT" ? "portrait" : value.startsWith("LANDSCAPE") ? "landscape" : null;
            if (!mapped)
                return null; // UPSIDE_DOWN etc. → Maestro fallback
            return run(bin, ["device", "orientation", "set", mapped, "--device", udid], {
                timeout: 15_000,
            });
        },
        getOrientation: async (udid) => {
            const r = await run(bin, ["device", "orientation", "get", "--device", udid], {
                timeout: 10_000,
            });
            if (r.code !== 0)
                return null;
            try {
                const parsed = JSON.parse(r.stdout);
                const o = parsed.data?.orientation;
                return typeof o === "string" ? o : null;
            }
            catch {
                return null;
            }
        },
    };
}
// ─── idb backend ─────────────────────────────────────────────────────────────
function makeIdbBackend() {
    return {
        name: "idb",
        tap: idbTap,
        swipe: idbSwipe,
        inputText: idbInputText,
        canPressKey: idbCanPressKey,
        pressKey: idbPressKey,
        describeAll: async (udid) => {
            const d = await idbDescribeAll(udid);
            if (!d.ok)
                return null;
            return d.elements.map((e) => ({
                label: String(e.AXLabel ?? ""),
                ...(e.AXValue ? { value: String(e.AXValue) } : {}),
                ...(e.type ? { type: String(e.type) } : {}),
                ...(e["AXUniqueId"] ? { identifier: String(e["AXUniqueId"]) } : {}),
                ...(e.frame ? { frame: e.frame } : {}),
            }));
        },
        screenPoints: async (udid) => {
            const r = await run("idb", ["describe", "--udid", udid, "--json"], { timeout: 15_000 });
            if (r.code !== 0)
                return null;
            try {
                const parsed = JSON.parse(r.stdout);
                const d = parsed.screen_dimensions;
                if (!d?.width || !d?.height)
                    return null;
                const density = d.density && d.density > 0 ? d.density : 1;
                return { w: d.width / density, h: d.height / density };
            }
            catch {
                return null;
            }
        },
        setOrientation: async () => null, // idb has no orientation control → Maestro
    };
}
// ─── Backend selection ───────────────────────────────────────────────────────
let cachedBackend;
/** Timestamp of the last probe that found no backend (0 = never). */
let negativeProbeAt = 0;
/** How long a "no backend" result is trusted before re-probing. */
const NEGATIVE_PROBE_TTL_MS = 30_000;
/**
 * Best available native backend: idb → mobilecli → null (Maestro fallback).
 *
 * A *positive* result is cached for the process lifetime. A *negative* result
 * (no backend) is cached only for NEGATIVE_PROBE_TTL_MS, then re-probed — so a
 * backend installed/started after server launch (e.g. idb_companion warming up)
 * is picked up instead of permanently downgrading to the slow Maestro path.
 */
export async function getBackend(overrides) {
    // Operational escape hatch: force the Maestro fallback path everywhere.
    if (process.env.PODIUM_DISABLE_NATIVE)
        return null;
    if (cachedBackend !== undefined)
        return cachedBackend;
    const now = overrides?.now ?? Date.now;
    const ttl = overrides?.negativeTtlMs ?? NEGATIVE_PROBE_TTL_MS;
    if (negativeProbeAt > 0 && now() - negativeProbeAt < ttl)
        return null;
    const probeIdb = overrides?.idbAvailable ?? idbAvailable;
    const probeMobilecli = overrides?.resolveMobilecli ?? resolveMobilecli;
    if (await probeIdb()) {
        cachedBackend = makeIdbBackend();
        return cachedBackend;
    }
    const mobilecli = await probeMobilecli();
    if (mobilecli) {
        cachedBackend = makeMobilecliBackend(mobilecli);
        return cachedBackend;
    }
    negativeProbeAt = now();
    return null;
}

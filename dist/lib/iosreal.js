/**
 * Real-iOS-device lifecycle driver (v0.3.0 story B1).
 *
 * Uses `xcrun devicectl` (Apple-official, Xcode 15+) for device list / install /
 * launch. devicectl/WDA/go-ios wire shapes cannot be verified without a paired,
 * signed real iPhone, so:
 *   - parseDevicectlDevices is a TOLERANT, pure parser, unit-tested against a
 *     representative fixture;
 *   - lifecycle ops that devicectl does not cleanly provide (terminate /
 *     screenshot / screenSize) FAIL CLOSED with an actionable message pointing at
 *     the WDA backend (story B2) instead of fabricating unverifiable commands.
 * Live command validation is gated to story B3 (hardware).
 *
 * Hard prereqs for the live path (documented for the user): macOS, a paired &
 * trusted device, a valid provisioning profile, and on iOS 17+ an RSD tunnel.
 */
import { run, commandExists } from "./exec.js";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
const XCRUN = "xcrun";
function toResult(r) {
    return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr, code: r.code };
}
function asObj(x) {
    return x && typeof x === "object" ? x : null;
}
function asStr(x) {
    return typeof x === "string" ? x : undefined;
}
/**
 * Tolerant parser for `xcrun devicectl list devices --json-output`. Accepts both
 * `{result:{devices:[...]}}` and a bare `{devices:[...]}`; keeps only iOS
 * hardware; extracts identifier/name/connection-state. Pure — exported for tests.
 */
export function parseDevicectlDevices(json) {
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        return [];
    }
    const root = asObj(parsed);
    const resultObj = asObj(root?.result);
    const rawDevices = (resultObj?.devices ?? root?.devices);
    if (!Array.isArray(rawDevices))
        return [];
    return rawDevices.flatMap((d) => {
        const rec = asObj(d);
        if (!rec)
            return [];
        const hw = asObj(rec.hardwareProperties);
        const platform = asStr(hw?.platform);
        if (platform && platform.toLowerCase() !== "ios")
            return [];
        const udid = asStr(rec.identifier) ?? asStr(rec.udid);
        if (!udid)
            return [];
        const props = asObj(rec.deviceProperties);
        const conn = asObj(rec.connectionProperties);
        const name = asStr(props?.name) ?? asStr(rec.name) ?? udid;
        const state = asStr(conn?.pairingState) ?? asStr(conn?.tunnelState) ?? "unknown";
        return [{ udid, platform: "ios-real", name, state, transport: "usb" }];
    });
}
async function listIosRealDevices() {
    const tmp = join(os.tmpdir(), `podium-devicectl-${Date.now()}.json`);
    try {
        const r = await run(XCRUN, ["devicectl", "list", "devices", "--json-output", tmp], {
            timeout: 30_000,
        });
        if (r.code !== 0)
            return [];
        const json = await readFile(tmp, "utf8").catch(() => "");
        return parseDevicectlDevices(json);
    }
    finally {
        await unlink(tmp).catch(() => undefined);
    }
}
const WDA_NOTE = "is handled by the WDA backend (story B2) and validated on hardware (story B3)";
export const iosRealDriver = {
    platform: "ios-real",
    list: listIosRealDevices,
    install: async (udid, appPath) => toResult(await run(XCRUN, ["devicectl", "device", "install", "app", "--device", udid, appPath], {
        timeout: 120_000,
    })),
    launch: async (udid, bundleId) => toResult(await run(XCRUN, ["devicectl", "device", "process", "launch", "--device", udid, bundleId], {
        timeout: 60_000,
    })),
    terminate: async (_udid, bundleId) => ({
        ok: false,
        error: `terminating ${bundleId} on a real iOS device ${WDA_NOTE}; devicectl has no stable terminate-by-bundle.`,
    }),
    screenshot: async (udid, outPath) => {
        // A real device screenshots via idb (needs idb_companion) or libimobiledevice's
        // idevicescreenshot; devicectl has no screenshot. Prefer idb, but FALL THROUGH to
        // idevicescreenshot when idb is present-but-broken (e.g. companion missing —
        // verified on an iPhone 12 Pro Max where idb errored). Fail closed otherwise.
        const hasIdb = await commandExists("idb");
        const hasIdevicescreenshot = await commandExists("idevicescreenshot");
        if (hasIdb) {
            const r = await run("idb", ["screenshot", outPath, "--udid", udid], { timeout: 30_000 });
            if (r.code === 0)
                return toResult(r);
            if (!hasIdevicescreenshot) {
                return {
                    ok: false,
                    code: r.code,
                    error: `idb screenshot failed — ensure idb_companion is installed and the device is connected (brew install facebook/fb/idb-companion): ${(r.stderr || "").split("\n")[0]}`,
                };
            }
            // idb failed but idevicescreenshot is available — try it below.
        }
        if (hasIdevicescreenshot) {
            const r = await run("idevicescreenshot", ["-u", udid, outPath], { timeout: 30_000 });
            if (r.code === 0)
                return toResult(r);
            return { ok: false, code: r.code, error: `idevicescreenshot failed: ${(r.stderr || "").split("\n")[0]}` };
        }
        return {
            ok: false,
            error: "real-iOS screenshot needs idb_companion (brew install facebook/fb/idb-companion) or libimobiledevice (brew install libimobiledevice)",
        };
    },
    screenSize: async () => null, // provided via WDA (story B2)
};

import { listDevicesCached, boot, install, launch, terminate, screenshot, measureScreen, } from "../simctl.js";
export const iosSimDriver = {
    platform: "ios-sim",
    async list() {
        const r = await listDevicesCached();
        if (!r.ok)
            return [];
        return r.devices.map((d) => ({
            udid: d.udid,
            platform: "ios-sim",
            name: d.name,
            state: d.state,
            transport: "simulator",
        }));
    },
    boot: (udid) => boot(udid),
    install: (udid, appPath) => install(udid, appPath),
    launch: (udid, bundleId) => launch(udid, bundleId),
    terminate: (udid, bundleId) => terminate(udid, bundleId),
    screenshot: (udid, outPath) => screenshot(udid, outPath),
    async screenSize(udid) {
        const r = await measureScreen(udid);
        if (!r.ok || r.widthPx == null || r.heightPx == null)
            return null;
        return { widthPx: r.widthPx, heightPx: r.heightPx };
    },
};

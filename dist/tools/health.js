import { commandExists } from "../lib/exec.js";
import { getBackend, resolveMobilecli } from "../lib/native.js";
const TOOL_NAME = "podium_health";
const VERSION = "0.2.0";
const NAME = "podium-mcp";
export function registerHealthTool(server) {
    server.tool(TOOL_NAME, "Returns health status of the podium-mcp server and toolchain availability. " +
        "Scope: podium's automation tools target iOS simulators (macOS + Xcode). adb is detected " +
        "for visibility but Android devices are not yet automatable.", {}, async () => {
        const [xcrun, maestro, adb, idb, mobilecli, backend] = await Promise.all([
            commandExists("xcrun"),
            commandExists("maestro"),
            commandExists("adb"),
            commandExists("idb"),
            resolveMobilecli().then((p) => p !== null),
            getBackend(),
        ]);
        const payload = {
            name: NAME,
            version: VERSION,
            platform: "ios-simulator",
            toolchain: { xcrun, maestro, adb, idb, mobilecli },
            gestureBackend: backend
                ? `${backend.name} (native)`
                : maestro
                    ? "maestro (fallback)"
                    : "none",
        };
        return {
            content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        };
    });
}

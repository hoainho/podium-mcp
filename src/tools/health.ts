import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { commandExists } from "../lib/exec.js";
import { getBackend, resolveMobilecli } from "../lib/native.js";

const TOOL_NAME = "podium_health";
const VERSION = "0.3.0";
const NAME = "podium-mcp";

export function registerHealthTool(server: McpServer): void {
  server.tool(
    TOOL_NAME,
    "Returns health status of the podium-mcp server and toolchain availability. " +
      "Scope: iOS (simulator + real device), Android (emulator + real via adb), and game-engine " +
      "(Unity/GL via AltTester) automation. macOS + Xcode required; adb for Android, an instrumented " +
      "build for engine tools.",
    {},
    async () => {
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
        platforms: ["ios-sim", "ios-real", "android"],
        toolchain: { xcrun, maestro, adb, idb, mobilecli },
        gestureBackend: backend
          ? `${backend.name} (native)`
          : maestro
            ? "maestro (fallback)"
            : "none",
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}

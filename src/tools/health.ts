import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { commandExists } from "../lib/exec.js";

const TOOL_NAME = "podium_health";
const VERSION = "0.1.0";
const NAME = "podium-mcp";

export function registerHealthTool(server: McpServer): void {
  server.tool(
    TOOL_NAME,
    "Returns health status of the podium-mcp server and toolchain availability.",
    {},
    async () => {
      const [xcrun, maestro, adb] = await Promise.all([
        commandExists("xcrun"),
        commandExists("maestro"),
        commandExists("adb"),
      ]);

      const payload = {
        name: NAME,
        version: VERSION,
        toolchain: { xcrun, maestro, adb },
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}

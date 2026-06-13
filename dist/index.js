#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerHealthTool } from "./tools/health.js";
import { registerDeviceTools } from "./tools/device.js";
import { registerScreenTools } from "./tools/screen.js";
import { registerStepsTools } from "./tools/steps.js";
import { registerFlowTools } from "./tools/flow.js";
import { registerDebugTools } from "./tools/debug.js";
import { registerWebviewTools } from "./tools/webview.js";
import { prefetchDevices } from "./lib/simctl.js";
import { getBackend } from "./lib/native.js";
const server = new McpServer({
    name: "podium",
    version: "0.1.0",
});
registerHealthTool(server);
registerDeviceTools(server);
registerScreenTools(server);
registerStepsTools(server);
registerFlowTools(server);
registerDebugTools(server);
registerWebviewTools(server);
// Fire-and-forget warm-ups: device-list cache + native-backend probe.
// Neither blocks connect; the first tool calls hit warm state instead.
prefetchDevices();
void getBackend().catch(() => undefined);
const transport = new StdioServerTransport();
await server.connect(transport);

#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerHealthTool } from "./tools/health.js";
import { registerDeviceTools } from "./tools/device.js";
import { registerScreenTools } from "./tools/screen.js";
import { registerFlowTools } from "./tools/flow.js";
import { registerDebugTools } from "./tools/debug.js";
const server = new McpServer({
    name: "podium",
    version: "0.1.0",
});
registerHealthTool(server);
registerDeviceTools(server);
registerScreenTools(server);
registerFlowTools(server);
registerDebugTools(server);
const transport = new StdioServerTransport();
await server.connect(transport);

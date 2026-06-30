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
import { registerAssertTools } from "./tools/assert.js";
import { registerValidateTools } from "./tools/validate.js";
import { registerEngineTools } from "./tools/engine.js";
import { registerCanvasTools } from "./tools/canvas.js";
import { registerTokenTools } from "./tools/token.js";
import { prefetchDevices } from "./lib/simctl.js";
import { getBackend } from "./lib/native.js";
import { registerDriver } from "./lib/device-target.js";
import { iosSimDriver } from "./lib/drivers/ios-sim.js";
import { androidDriver } from "./lib/adb.js";
import { iosRealDriver } from "./lib/iosreal.js";

const server = new McpServer({
  name: "podium",
  version: "0.4.1",
});

registerHealthTool(server);
registerDeviceTools(server);
registerScreenTools(server);
registerStepsTools(server);
registerFlowTools(server);
registerDebugTools(server);
registerWebviewTools(server);
registerAssertTools(server);
registerValidateTools(server);
registerEngineTools(server);
registerCanvasTools(server);
registerTokenTools(server);

// Register platform drivers (v0.3.0): ios-sim wraps simctl. The android and
// ios-real drivers register here as they land.
registerDriver(iosSimDriver);
registerDriver(androidDriver);
registerDriver(iosRealDriver);

// Fire-and-forget warm-ups: device-list cache + native-backend probe.
// Neither blocks connect; the first tool calls hit warm state instead.
prefetchDevices();
void getBackend().catch(() => undefined);

const transport = new StdioServerTransport();
await server.connect(transport);

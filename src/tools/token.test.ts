import { describe, it, expect } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTokenTools } from "./token.js";

interface ToolRes {
  content: { type: string; text: string }[];
  isError?: boolean;
}
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolRes>;

function setup(): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const tool = (name: string, _d: string, _s: unknown, handler: ToolHandler): void => {
    handlers.set(name, handler);
  };
  registerTokenTools({ tool } as unknown as McpServer);
  return handlers;
}

function payload(res: ToolRes): Record<string, unknown> {
  return JSON.parse(res.content[0].text) as Record<string, unknown>;
}

describe("podium_token_report", () => {
  it("shows the no-vision flow is cheaper than the vision loop", async () => {
    const out = payload(await setup().get("podium_token_report")!({}));
    const flow = out.flow as { noVisionTokens: number; visionTokens: number; savingsRatio: number; percentFewerTokens: number };
    expect(flow.savingsRatio).toBeGreaterThan(1);
    expect(flow.noVisionTokens).toBeLessThan(flow.visionTokens);
    expect(flow.percentFewerTokens).toBeGreaterThan(0);

    const shot = out.screenshot as { tokens: number };
    const step = out.structuredStep as { tokens: number };
    expect(shot.tokens).toBeGreaterThan(step.tokens);

    const tools = out.toolDefs as { estimatedOverheadTokens: number; avgPerToolTokens: number };
    expect(tools.estimatedOverheadTokens).toBeGreaterThan(0);
    expect(tools.avgPerToolTokens).toBeGreaterThan(0);
    expect(typeof out.summary).toBe("string");
  });

  it("scales the flow totals with the step count", async () => {
    const a = payload(await setup().get("podium_token_report")!({ steps: 4 }));
    const b = payload(await setup().get("podium_token_report")!({ steps: 16 }));
    const fa = a.flow as { visionTokens: number; noVisionTokens: number };
    const fb = b.flow as { visionTokens: number; noVisionTokens: number };
    expect(fb.visionTokens).toBeGreaterThan(fa.visionTokens);
    expect(fb.noVisionTokens).toBeGreaterThan(fa.noVisionTokens);
  });
});

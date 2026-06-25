import { describe, it, expect } from "vitest";
import { registerTokenTools } from "./token.js";
function setup() {
    const handlers = new Map();
    const tool = (name, _d, _s, handler) => {
        handlers.set(name, handler);
    };
    registerTokenTools({ tool });
    return handlers;
}
function payload(res) {
    return JSON.parse(res.content[0].text);
}
describe("podium_token_report", () => {
    it("shows the no-vision flow is cheaper than the vision loop", async () => {
        const out = payload(await setup().get("podium_token_report")({}));
        const flow = out.flow;
        expect(flow.savingsRatio).toBeGreaterThan(1);
        expect(flow.noVisionTokens).toBeLessThan(flow.visionTokens);
        expect(flow.percentFewerTokens).toBeGreaterThan(0);
        const shot = out.screenshot;
        const step = out.structuredStep;
        expect(shot.tokens).toBeGreaterThan(step.tokens);
        const tools = out.toolDefs;
        expect(tools.estimatedOverheadTokens).toBeGreaterThan(0);
        expect(tools.avgPerToolTokens).toBeGreaterThan(0);
        expect(typeof out.summary).toBe("string");
    });
    it("scales the flow totals with the step count", async () => {
        const a = payload(await setup().get("podium_token_report")({ steps: 4 }));
        const b = payload(await setup().get("podium_token_report")({ steps: 16 }));
        const fa = a.flow;
        const fb = b.flow;
        expect(fb.visionTokens).toBeGreaterThan(fa.visionTokens);
        expect(fb.noVisionTokens).toBeGreaterThan(fa.noVisionTokens);
    });
});

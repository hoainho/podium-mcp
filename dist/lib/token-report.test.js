import { describe, it, expect } from "vitest";
import { estimateTokens, estimateImageTokens, measureToolDefs, compareFlows, } from "./token-report.js";
// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------
describe("estimateTokens", () => {
    it("returns ceil(length / 4)", () => {
        expect(estimateTokens("abcd")).toBe(1); // 4 chars → 1 token
        expect(estimateTokens("abcde")).toBe(2); // 5 chars → ceil(5/4)=2
        expect(estimateTokens("")).toBe(0); // empty → 0
        expect(estimateTokens("abc")).toBe(1); // 3 chars → ceil(3/4)=1
    });
    it("is monotonically non-decreasing as text grows", () => {
        const lengths = [0, 1, 4, 5, 16, 17, 100, 401];
        let prev = -1;
        for (const len of lengths) {
            const tokens = estimateTokens("x".repeat(len));
            expect(tokens).toBeGreaterThanOrEqual(prev);
            prev = tokens;
        }
    });
    it("approximates length / 4 for longer text", () => {
        const text = "a".repeat(400);
        const tokens = estimateTokens(text);
        // ceil(400/4) = 100 exactly
        expect(tokens).toBe(100);
    });
});
// ---------------------------------------------------------------------------
// estimateImageTokens
// ---------------------------------------------------------------------------
describe("estimateImageTokens", () => {
    it("matches ceil((width * height) / 750) for a known size", () => {
        // 1170 × 2532 = 2,962,440 pixels; ceil(2962440/750) = ceil(3949.92) = 3950
        // But the cap is 2048, so the result should be clamped
        expect(estimateImageTokens(1170, 2532)).toBe(2048);
    });
    it("returns the unclamped formula result for small images", () => {
        // 100 × 100 = 10,000 pixels; ceil(10000/750) = ceil(13.33) = 14
        expect(estimateImageTokens(100, 100)).toBe(14);
    });
    it("clamps at 2048 for very large screenshots", () => {
        // 4000 × 4000 = 16,000,000; unclamped = 21,334 → should cap at 2048
        expect(estimateImageTokens(4000, 4000)).toBe(2048);
    });
    it("returns 0 for a zero-dimension image", () => {
        expect(estimateImageTokens(0, 100)).toBe(0);
        expect(estimateImageTokens(100, 0)).toBe(0);
    });
});
// ---------------------------------------------------------------------------
// measureToolDefs
// ---------------------------------------------------------------------------
describe("measureToolDefs", () => {
    const tools = [
        {
            name: "tap_on",
            description: "Tap on an element by label or selector.",
            schema: { type: "object", properties: { selector: { type: "string" } } },
        },
        {
            name: "screenshot",
            description: "Take a screenshot of the current screen.",
            schema: { type: "object", properties: {} },
        },
        {
            name: "input_text",
            description: "Type text into the focused input field.",
            schema: { type: "object", properties: { text: { type: "string" } } },
        },
    ];
    it("perTool entries sum to totalTokens", () => {
        const report = measureToolDefs(tools);
        const sum = report.perTool.reduce((acc, t) => acc + t.tokens, 0);
        expect(report.totalTokens).toBe(sum);
    });
    it("each perTool name matches the input tool name", () => {
        const report = measureToolDefs(tools);
        expect(report.perTool.map((t) => t.name)).toEqual(tools.map((t) => t.name));
    });
    it("each perTool token count is positive for non-empty tools", () => {
        const report = measureToolDefs(tools);
        for (const t of report.perTool) {
            expect(t.tokens).toBeGreaterThan(0);
        }
    });
    it("returns zero total for an empty tool list", () => {
        const report = measureToolDefs([]);
        expect(report.totalTokens).toBe(0);
        expect(report.perTool).toHaveLength(0);
    });
});
// ---------------------------------------------------------------------------
// compareFlows
// ---------------------------------------------------------------------------
describe("compareFlows", () => {
    it("savingsRatio > 1 when the vision loop consumes more tokens than the structured flow", () => {
        // noVision: 8 text steps with small structured lists (~80 chars each)
        const noVision = Array.from({ length: 8 }, () => ({
            kind: "text",
            text: "element:PlayButton x:540 y:1200 enabled:true\nelement:ScoreLabel x:100 y:50 enabled:true",
        }));
        // visionLoop: 8 screenshot steps at iPhone 14 resolution
        const visionLoop = Array.from({ length: 8 }, () => ({
            kind: "image",
            width: 1170,
            height: 2532,
        }));
        const result = compareFlows(noVision, visionLoop);
        expect(result.savingsRatio).toBeGreaterThan(1);
        expect(result.visionTokens).toBeGreaterThan(result.noVisionTokens);
    });
    it("no divide-by-zero on empty flows — savingsRatio is 1.0", () => {
        const result = compareFlows([], []);
        expect(result.noVisionTokens).toBe(0);
        expect(result.visionTokens).toBe(0);
        expect(result.savingsRatio).toBe(1);
    });
    it("no divide-by-zero when noVision is empty but visionLoop is not", () => {
        const visionLoop = [{ kind: "image", width: 100, height: 100 }];
        const result = compareFlows([], visionLoop);
        expect(Number.isFinite(result.savingsRatio)).toBe(true);
        expect(Number.isNaN(result.savingsRatio)).toBe(false);
    });
    it("breakdown fields are consistent with totals", () => {
        const noVision = [{ kind: "text", text: "hello world" }];
        const visionLoop = [
            { kind: "image", width: 100, height: 100 },
            { kind: "text", text: "done" },
        ];
        const result = compareFlows(noVision, visionLoop);
        expect(result.noVisionTokens).toBe(result.breakdown.noVisionTextTokens);
        expect(result.visionTokens).toBe(result.breakdown.visionTextTokens + result.breakdown.visionImageTokens);
        expect(result.breakdown.noVisionSteps).toBe(1);
        expect(result.breakdown.visionSteps).toBe(2);
    });
});

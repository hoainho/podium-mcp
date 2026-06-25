/**
 * podium_token_report (v0.4.0) — quantifies Podium's token savings.
 *
 * Podium's design thesis is "no-vision first": drive UIs as structured element
 * lists instead of feeding screenshots to a vision model every step. This tool
 * turns that claim into numbers — it computes, for an equivalent N-step flow,
 * the input-token cost of (a) Podium's structured no-vision flow vs (b) a
 * screenshot/vision loop, plus the fixed per-request tool-definition overhead.
 *
 * Estimates use the heuristic estimators in lib/token-report.ts (~4 chars/token
 * for text; Anthropic's ~750 px/token for images). They are deliberately
 * dependency-free and deterministic; for exact figures, swap in the Anthropic
 * count_tokens API. Numbers are computed here, never hard-coded.
 */
import { z } from "zod";
import { okResult } from "../lib/result.js";
import { estimateTokens, estimateImageTokens, measureToolDefs, compareFlows, } from "../lib/token-report.js";
/** A representative sample of Podium tool defs, used to estimate the average
 *  per-tool schema cost; scaled to the full tool count for the overhead figure.
 *  (Sampling avoids hand-transcribing all ~51 schemas while staying honest:
 *  the average is measured from real shapes, not invented.) */
const SAMPLE_TOOLS = [
    {
        name: "tap_on",
        description: "Taps an element by text or id (resolved via the native element list) or at x/y coordinates; native tap with a Maestro fallback, reports the backend used.",
        schema: { udid: "string", bundleId: "string", text: "string?", id: "string?", x: "number?", y: "number?", double: "boolean?", long: "boolean?" },
    },
    {
        name: "canvas_resolve",
        description: "Resolves a fuzzy intent (e.g. close, settings) to a ranked, evidenced canvas target without tapping; returns best, candidates with reasons, and a fail-closed confidentEnough flag.",
        schema: { udid: "string", intent: "string", webviewId: "string?" },
    },
    {
        name: "webview_network",
        description: "Captures HTTP traffic made inside a WebView (fetch + XMLHttpRequest) and exports redacted JSON or a HAR 1.2 log; injects an in-page recorder via eval and captures for durationMs.",
        schema: { udid: "string", webviewId: "string?", durationMs: "number?", format: "json|har", saveTo: "string?", redact: "boolean?", includeResources: "boolean?" },
    },
];
/** Build a realistic structured element-list payload of `n` elements — the
 *  per-step text Podium returns instead of a screenshot. */
function structuredStep(n) {
    const els = Array.from({ length: Math.max(0, n) }, (_, i) => ({
        name: `node_${i}`,
        type: i % 2 === 0 ? "PIXI.Sprite" : "Konva.Group",
        text: i % 3 === 0 ? "Play" : "",
        x: 100 + i * 7,
        y: 200 + i * 11,
    }));
    return JSON.stringify(els);
}
export function registerTokenTools(server) {
    server.tool("podium_token_report", "Quantifies Podium's token savings: for an N-step flow, computes input tokens for Podium's no-vision " +
        "structured flow vs a screenshot/vision loop, the savings ratio, and the fixed per-request tool-definition " +
        "overhead. Heuristic estimates (~4 chars/token text, ~750 px/token image) — deterministic, no network.", {
        steps: z.number().int().min(1).max(200).optional().describe("Flow length (default 8)"),
        screenshotWidth: z.number().int().positive().optional().describe("Vision-loop screenshot width px (default 1179)"),
        screenshotHeight: z.number().int().positive().optional().describe("Vision-loop screenshot height px (default 2556)"),
        elementsPerStep: z.number().int().min(1).max(500).optional().describe("Structured elements returned per step (default 20)"),
        toolCount: z.number().int().min(1).max(500).optional().describe("Registered tool count for the overhead estimate (default 51)"),
    }, async ({ steps, screenshotWidth, screenshotHeight, elementsPerStep, toolCount }) => {
        const n = steps ?? 8;
        const w = screenshotWidth ?? 1179;
        const h = screenshotHeight ?? 2556;
        const els = elementsPerStep ?? 20;
        const tools = toolCount ?? 51;
        // Equivalent flows: each step is either a structured element list (Podium)
        // or a screenshot + a short reasoning prompt (vision loop).
        const noVision = Array.from({ length: n }, () => ({ kind: "text", text: structuredStep(els) }));
        const visionLoop = Array.from({ length: n }, () => [
            { kind: "image", width: w, height: h },
            { kind: "text", text: "Look at the screenshot and decide the next tap." },
        ]).flat();
        const flow = compareFlows(noVision, visionLoop);
        // Tool-def overhead: average per-tool cost from a real sample, scaled to the surface.
        const sample = measureToolDefs(SAMPLE_TOOLS);
        const avgPerTool = sample.totalTokens / SAMPLE_TOOLS.length;
        const toolDefOverheadTokens = Math.round(avgPerTool * tools);
        const perScreenshotTokens = estimateImageTokens(w, h);
        const perStructuredStepTokens = estimateTokens(structuredStep(els));
        const savings = flow.savingsRatio;
        const pctFewer = flow.visionTokens > 0 ? Math.round((1 - flow.noVisionTokens / flow.visionTokens) * 1000) / 10 : 0;
        const summary = `Podium no-vision vs screenshot/vision loop over ${n} steps: ` +
            `${flow.noVisionTokens.toLocaleString()} vs ${flow.visionTokens.toLocaleString()} input tokens ` +
            `→ ${savings.toFixed(2)}× cheaper (${pctFewer}% fewer). ` +
            `Per step: 1 screenshot ≈ ${perScreenshotTokens} tokens vs a ${els}-element list ≈ ${perStructuredStepTokens} tokens. ` +
            `Fixed tool-def overhead ≈ ${toolDefOverheadTokens.toLocaleString()} tokens/request across ${tools} tools ` +
            `(~${Math.round(avgPerTool)}/tool). Heuristic estimate — use Anthropic count_tokens for exact figures.`;
        return okResult({
            method: "heuristic (~4 chars/token text, ~750 px/token image); deterministic, no network",
            steps: n,
            screenshot: { width: w, height: h, tokens: perScreenshotTokens },
            structuredStep: { elements: els, tokens: perStructuredStepTokens },
            flow: {
                noVisionTokens: flow.noVisionTokens,
                visionTokens: flow.visionTokens,
                savingsRatio: Math.round(savings * 100) / 100,
                percentFewerTokens: pctFewer,
                breakdown: flow.breakdown,
            },
            toolDefs: { toolCount: tools, estimatedOverheadTokens: toolDefOverheadTokens, avgPerToolTokens: Math.round(avgPerTool) },
            summary,
        });
    });
}

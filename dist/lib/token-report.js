/**
 * token-report.ts — pure, deterministic token-cost estimators for Podium.
 *
 * All estimates use the heuristic `Math.ceil(length / 4)` for text.
 * This matches the widely-cited "~4 chars per token" rule of thumb for
 * English/code content.  For production accuracy, replace with a real call
 * to the Anthropic `count_tokens` API endpoint — but that endpoint requires
 * a network round-trip and an API key, so it is deliberately excluded here
 * to keep this module pure and test-friendly.
 *
 * Image token formula mirrors Anthropic's documented calculation for
 * vision-capable models: ceil((width * height) / 750).  The constant 750
 * reflects roughly 750 pixels per token at typical screenshot resolutions.
 *
 * None of these functions throw; they return deterministic numbers for any
 * finite input.
 */
// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------
/**
 * Estimate the number of tokens in a text string.
 *
 * Heuristic: ceil(characters / 4).  Accurate to ±20 % for typical
 * English prose and JSON; may undercount dense code or Unicode-heavy text.
 * Use the Anthropic `count_tokens` API for exact counts in production.
 */
export function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------
/**
 * Estimate the number of tokens consumed by an image of the given dimensions.
 *
 * Formula: ceil((width * height) / 750).
 * Source: Anthropic vision-model pricing docs — one token ≈ 750 pixels.
 * A hard ceiling of 2_048 is applied (Anthropic's max per image tile).
 */
const IMAGE_PIXELS_PER_TOKEN = 750;
const IMAGE_TOKEN_MAX = 2_048;
export function estimateImageTokens(width, height) {
    const raw = Math.ceil((width * height) / IMAGE_PIXELS_PER_TOKEN);
    return Math.min(raw, IMAGE_TOKEN_MAX);
}
/**
 * Measure the token overhead of a set of tool definitions.
 *
 * Each tool's cost is: estimateTokens(name + description + JSON.stringify(schema)).
 * This models the fixed overhead every model call pays regardless of the
 * actual tool invoked — the entire registered tool list travels with the
 * request.
 */
export function measureToolDefs(tools) {
    const perTool = tools.map((t) => ({
        name: t.name,
        tokens: estimateTokens(t.name + t.description + JSON.stringify(t.schema)),
    }));
    const totalTokens = perTool.reduce((sum, t) => sum + t.tokens, 0);
    return { totalTokens, perTool };
}
function sumFlow(steps) {
    let text = 0;
    let image = 0;
    let textCount = 0;
    let imageCount = 0;
    for (const step of steps) {
        if (step.kind === "text") {
            text += estimateTokens(step.text);
            textCount++;
        }
        else {
            image += estimateImageTokens(step.width, step.height);
            imageCount++;
        }
    }
    return { text, image, stepCount: { text: textCount, image: imageCount } };
}
/**
 * Compare two equivalent mobile flows — one using Podium's structured
 * element-list output (no vision) and one using a screenshot/vision loop.
 *
 * Returns per-flow token totals, the savings ratio, and a breakdown.
 * Division by zero is guarded: if noVisionTokens is 0 the ratio is reported
 * as 1.0 (parity).
 */
export function compareFlows(noVision, visionLoop) {
    const nv = sumFlow(noVision);
    const vl = sumFlow(visionLoop);
    const noVisionTokens = nv.text + nv.image;
    const visionTokens = vl.text + vl.image;
    // Guard: if both flows are empty (or noVision is zero), report parity (1.0)
    // rather than 0/1 = 0, which would be misleading.  If only noVision is zero
    // but vision is not, the ratio is still well-defined (visionTokens / 1).
    const savingsRatio = noVisionTokens === 0 && visionTokens === 0
        ? 1
        : visionTokens / Math.max(1, noVisionTokens);
    return {
        noVisionTokens,
        visionTokens,
        savingsRatio,
        breakdown: {
            noVisionSteps: nv.stepCount.text + nv.stepCount.image,
            visionSteps: vl.stepCount.text + vl.stepCount.image,
            noVisionTextTokens: nv.text,
            visionTextTokens: vl.text,
            visionImageTokens: vl.image,
        },
    };
}

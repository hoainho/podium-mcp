/**
 * canvas-vision.ts — opt-in, token-budgeted OCR/vision fallback for Canvas Brain.
 *
 * This is the LAST rung of the no-vision-first ladder and is deliberately
 * fail-closed: vision is never triggered unless the caller holds an explicit
 * allow flag (derived from PODIUM_ALLOW_VISION=1), and any OCR failure returns
 * an empty result rather than throwing.
 */
// ---------------------------------------------------------------------------
// Environment gate
// ---------------------------------------------------------------------------
/**
 * Returns true only when `env.PODIUM_ALLOW_VISION === "1"`.
 * All other values (including "true", "yes", "on") are treated as disabled so
 * callers must opt in explicitly.
 */
export function isVisionAllowed(env) {
    return env["PODIUM_ALLOW_VISION"] === "1";
}
// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------
/**
 * Estimate image tokens for a raster of the given dimensions.
 * Mirrors token-report.ts (lead may dedupe); kept local so this module is
 * self-contained.
 */
function estimateImageTokens(w, h) {
    return Math.ceil((w * h) / 750);
}
// ---------------------------------------------------------------------------
// Role inference
// ---------------------------------------------------------------------------
/** Infer a semantic role from visible text (best-effort, never throws). */
function inferRole(text) {
    const t = text.trim().toLowerCase();
    if (t === "x" || t === "close" || t === "×" || t === "✕")
        return "close";
    if (t === "ok" || t === "okay" || t === "confirm")
        return "button";
    if (t === "cancel" || t === "dismiss")
        return "button";
    return undefined;
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * Inspect a canvas screenshot with OCR, producing CanvasObject[] with token
 * accounting.
 *
 * Fail-closed contract:
 * - If `opts.allow` is false → no OCR call, no token spend, empty result.
 * - If OCR throws → returns allowed:true, visionUsed:false, empty result, tokenCost:0.
 * - Never throws regardless of input.
 */
export async function visionInspect(imagePath, opts) {
    if (!opts.allow) {
        return { allowed: false, visionUsed: false, objects: [], tokenCost: 0 };
    }
    const tokenCost = estimateImageTokens(opts.imageWH.width, opts.imageWH.height);
    let ocrItems;
    try {
        ocrItems = await opts.ocr(imagePath);
    }
    catch {
        // OCR failed — fail-closed: no objects, no cost charged
        return { allowed: true, visionUsed: false, objects: [], tokenCost: 0 };
    }
    const objects = ocrItems.map((item) => {
        const cx = item.bbox.x + item.bbox.width / 2;
        const cy = item.bbox.y + item.bbox.height / 2;
        const role = inferRole(item.text);
        return {
            name: item.text || "vision-node",
            x: cx,
            y: cy,
            bbox: item.bbox,
            source: "vision",
            framework: "vision",
            text: item.text || undefined,
            role,
            visible: true,
            interactable: true,
        };
    });
    return { allowed: true, visionUsed: true, objects, tokenCost };
}

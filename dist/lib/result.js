/**
 * Shared MCP tool-result helpers — the single source for the ok/error shape.
 *
 * Model-agnostic contract (G003): every result carries a machine-readable
 * `status` and, where useful, a `next` list of suggested follow-up actions, on
 * BOTH the text channel (what most models read) and the `structuredContent`
 * channel (MCP's typed channel). The intent is that a weaker model is *told*
 * the state and what to do next, instead of inferring it from free-form prose.
 *
 * Backward compatible: `okResult(payload)` and `errorResult("msg")` keep their
 * old text shape (existing call sites + tests are unaffected); the new fields
 * are additive.
 */
function isObject(v) {
    return v != null && typeof v === "object" && !Array.isArray(v);
}
export function okResult(payload, opts = {}) {
    const status = opts.status ?? "ok";
    const body = isObject(payload)
        ? { ...payload, status } // envelope status is authoritative (opts/default wins over any payload field)
        : { status, value: payload };
    if (opts.next && opts.next.length)
        body.next = opts.next;
    return {
        content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
        structuredContent: body,
    };
}
export function errorResult(e) {
    const err = typeof e === "string" ? { code: "failed", message: e } : e;
    const lines = [err.message];
    if (err.remediation)
        lines.push(`→ Fix: ${err.remediation}`);
    if (err.suggestedTool)
        lines.push(`→ Next: ${err.suggestedTool}`);
    if (err.candidates && err.candidates.length)
        lines.push(`→ Candidates: ${JSON.stringify(err.candidates)}`);
    return {
        isError: true,
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: {
            status: (typeof err.code === "string" && ["needs_retry", "ambiguous", "failed_precondition", "unverifiable", "failed"].includes(err.code)
                ? err.code
                : "failed"),
            error: err,
        },
    };
}

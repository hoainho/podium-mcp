/**
 * Model-agnosticism "decidability" invariant (G006).
 *
 * The project thesis: decision logic lives in the SERVER, not the model. A
 * tool result is "decidable" when a zero-inference agent — one that reads only
 * the machine-readable envelope, never reasoning over prose — can pick its next
 * action. If every decision point in a canonical flow is decidable, then a weak
 * model can drive the flow as reliably as a strong one: the guidance is the
 * server's, not the model's.
 *
 * A result is decidable iff:
 *  - SUCCESS: structuredContent.status === "ok"  (optionally with next[]), OR
 *  - SOFT-FAIL (okResult w/ non-ok status, e.g. run_steps batch): status is a
 *    known non-ok status AND a non-empty next[] tells the agent what to do, OR
 *  - HARD-FAIL (isError): structuredContent.status is a known non-ok status AND
 *    the error carries at least one machine-actionable field
 *    (remediation | suggestedTool | candidates).
 */
const NON_OK = new Set(["needs_retry", "ambiguous", "failed_precondition", "unverifiable", "failed"]);
function asRecord(v) {
    return v != null && typeof v === "object" ? v : null;
}
export function evaluateDecidability(res) {
    const sc = asRecord(res.structuredContent);
    if (!sc)
        return { decidable: false, status: null, reason: "no structuredContent (model must parse prose)" };
    const status = typeof sc["status"] === "string" ? sc["status"] : null;
    if (!status)
        return { decidable: false, status: null, reason: "no machine-readable status" };
    if (!res.isError) {
        if (status === "ok")
            return { decidable: true, status, reason: "success: status=ok" };
        // soft-fail: a non-ok status surfaced through okResult must carry next[]
        const next = sc["next"];
        if (NON_OK.has(status) && Array.isArray(next) && next.length > 0)
            return { decidable: true, status, reason: `soft-fail status=${status} with next[]` };
        return { decidable: false, status, reason: `non-ok status=${status} without actionable next[]` };
    }
    // hard error
    if (!NON_OK.has(status))
        return { decidable: false, status, reason: `error status=${status} not in known set` };
    const err = asRecord(sc["error"]);
    const actionable = !!err && (err["remediation"] != null || err["suggestedTool"] != null ||
        (Array.isArray(err["candidates"]) && err["candidates"].length > 0));
    return actionable
        ? { decidable: true, status, reason: `error status=${status} with remediation/suggestedTool/candidates` }
        : { decidable: false, status, reason: `error status=${status} lacks remediation/suggestedTool/candidates` };
}

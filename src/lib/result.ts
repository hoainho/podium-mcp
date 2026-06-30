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

/** Stable, machine-readable outcome status shared by every tool. */
export type ResultStatus =
  | "ok"
  | "needs_retry"
  | "ambiguous"
  | "failed_precondition"
  | "unverifiable"
  | "failed";

export interface OkOptions {
  /** Outcome status. Defaults to "ok". */
  status?: ResultStatus;
  /** Ordered, human+machine-readable suggested next actions (most-likely first). */
  next?: string[];
}

/** A structured, actionable error. `code` is machine-readable; `remediation`
 *  and `suggestedTool` tell a weak model exactly what to do next. */
export interface StructuredError {
  /** Machine-readable code, e.g. "failed_precondition" | "ambiguous_target" | "unverifiable". */
  code: ResultStatus | string;
  /** Human-readable summary (kept as the first text line for back-compat). */
  message: string;
  /** What the caller should do to resolve it. */
  remediation?: string;
  /** The specific tool to call next, with key args if helpful. */
  suggestedTool?: string;
  /** Optional candidate list for ambiguous targets (the fail-closed pattern). */
  candidates?: unknown[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

export function okResult(payload: unknown, opts: OkOptions = {}) {
  const status: ResultStatus = opts.status ?? "ok";
  const body: Record<string, unknown> = isObject(payload)
    ? { ...payload, status }   // envelope status is authoritative (opts/default wins over any payload field)
    : { status, value: payload };
  if (opts.next && opts.next.length) body.next = opts.next;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }],
    structuredContent: body,
  };
}

export function errorResult(e: string | StructuredError) {
  const err: StructuredError = typeof e === "string" ? { code: "failed", message: e } : e;
  const lines: string[] = [err.message];
  if (err.remediation) lines.push(`→ Fix: ${err.remediation}`);
  if (err.suggestedTool) lines.push(`→ Next: ${err.suggestedTool}`);
  if (err.candidates && err.candidates.length)
    lines.push(`→ Candidates: ${JSON.stringify(err.candidates)}`);
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: lines.join("\n") }],
    structuredContent: {
      status: (typeof err.code === "string" && ["needs_retry", "ambiguous", "failed_precondition", "unverifiable", "failed"].includes(err.code)
        ? err.code
        : "failed") as ResultStatus,
      error: err,
    },
  };
}

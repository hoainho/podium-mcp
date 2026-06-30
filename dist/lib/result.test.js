import { describe, it, expect } from "vitest";
import { okResult, errorResult } from "./result.js";
describe("result envelope (model-agnostic contract / G003)", () => {
    it("okResult injects status:'ok' and mirrors to structuredContent", () => {
        const r = okResult({ visible: true });
        const body = JSON.parse(r.content[0].text);
        expect(body).toMatchObject({ status: "ok", visible: true });
        expect(r.structuredContent).toMatchObject({ status: "ok", visible: true });
        expect(r.isError).toBeUndefined();
    });
    it("okResult honours an explicit status + next list (machine-readable guidance)", () => {
        const r = okResult({ ok: true }, { status: "needs_retry", next: ["call inspect_screen"] });
        const body = JSON.parse(r.content[0].text);
        expect(body.status).toBe("needs_retry");
        expect(body.next).toEqual(["call inspect_screen"]);
        expect(r.structuredContent).toMatchObject({ status: "needs_retry", next: ["call inspect_screen"] });
    });
    it("okResult wraps non-object payloads under value", () => {
        const r = okResult("hello");
        expect(JSON.parse(r.content[0].text)).toEqual({ status: "ok", value: "hello" });
    });
    it("errorResult(string) stays backward compatible (isError + bare message text)", () => {
        const r = errorResult("tap_on failed");
        expect(r.isError).toBe(true);
        expect(r.content[0].text).toBe("tap_on failed");
        expect(r.structuredContent).toMatchObject({ status: "failed", error: { code: "failed", message: "tap_on failed" } });
    });
    it("errorResult(structured) renders remediation + suggestedTool as actionable text lines", () => {
        const r = errorResult({
            code: "failed_precondition",
            message: "tap_on requires a target",
            remediation: "Call inspect_screen first",
            suggestedTool: "inspect_screen({ udid })",
        });
        expect(r.isError).toBe(true);
        expect(r.content[0].text).toContain("tap_on requires a target");
        expect(r.content[0].text).toContain("Fix: Call inspect_screen first");
        expect(r.content[0].text).toContain("Next: inspect_screen({ udid })");
        expect(r.structuredContent).toMatchObject({
            status: "failed_precondition",
            error: { code: "failed_precondition", suggestedTool: "inspect_screen({ udid })" },
        });
    });
    it("errorResult maps a known code into the machine-readable status", () => {
        expect(errorResult({ code: "ambiguous", message: "two matches" }).structuredContent.status).toBe("ambiguous");
        expect(errorResult({ code: "weird", message: "x" }).structuredContent.status).toBe("failed");
    });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as oracle from "../lib/oracle.js";

type HandlerFn = (a: Record<string, unknown>) => Promise<{ isError?: true; content: Array<{ type: string; text: string }> }>;

async function build() {
  const { registerAssertTools } = await import("./assert.js");
  const h = new Map<string, HandlerFn>();
  registerAssertTools({ tool: (n: string, _d: string, _s: unknown, fn: HandlerFn) => h.set(n, fn) } as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
  return h;
}

describe("assert tools", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("assert_visible passes when the oracle confirms presence", async () => {
    vi.spyOn(oracle, "checkVisible").mockResolvedValue({ visible: true, via: "webview-dom" });
    const h = await build();
    const res = await h.get("assert_visible")!({ udid: "U", selector: "#login" });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toMatchObject({ ok: true, via: "webview-dom" });
  });

  it("assert_visible fails (isError) when not visible", async () => {
    vi.spyOn(oracle, "checkVisible").mockResolvedValue({ visible: false, via: "native-a11y" });
    const h = await build();
    const res = await h.get("assert_visible")!({ udid: "U", text: "X" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/NOT visible/);
  });

  it("assert_visible reports UNVERIFIABLE (not a pass) when the oracle can't read the target", async () => {
    vi.spyOn(oracle, "checkVisible").mockResolvedValue({ visible: null, via: "unverifiable" });
    const h = await build();
    const res = await h.get("assert_visible")!({ udid: "U", text: "X" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/UNVERIFIABLE/);
  });

  it("assert_not_visible PASSES only when absence is confirmed", async () => {
    vi.spyOn(oracle, "checkVisible").mockResolvedValue({ visible: false, via: "webview-dom" });
    const h = await build();
    const res = await h.get("assert_not_visible")!({ udid: "U", selector: ".err" });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toMatchObject({ ok: true, notVisible: true });
  });

  it("assert_not_visible FAILS CLOSED on unverifiable — never a silent pass (the key safety case)", async () => {
    vi.spyOn(oracle, "checkVisible").mockResolvedValue({ visible: null, via: "unverifiable" });
    const h = await build();
    const res = await h.get("assert_not_visible")!({ udid: "U", text: "Error" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/UNVERIFIABLE|fail-closed/i);
    // must NOT report notVisible:true
    expect(res.content[0].text).not.toMatch(/"notVisible":\s*true/);
  });

  it("assert_not_visible fails when target is still visible", async () => {
    vi.spyOn(oracle, "checkVisible").mockResolvedValue({ visible: true, via: "native-a11y" });
    const h = await build();
    const res = await h.get("assert_not_visible")!({ udid: "U", text: "Spinner" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/STILL visible/);
  });

  it("wait_for_element passes/fails per the oracle", async () => {
    const h = await build();
    vi.spyOn(oracle, "checkVisible").mockResolvedValue({ visible: true, via: "native-a11y" });
    expect((await h.get("wait_for_element")!({ udid: "U", text: "Home" })).isError).toBeUndefined();
    vi.spyOn(oracle, "checkVisible").mockResolvedValue({ visible: false, via: "native-a11y" });
    expect((await h.get("wait_for_element")!({ udid: "U", text: "Home", timeoutMs: 0 })).isError).toBe(true);
  });
});

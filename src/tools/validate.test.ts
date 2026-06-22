import { describe, it, expect, vi, beforeEach } from "vitest";
import * as oracle from "../lib/oracle.js";
import * as crash from "../lib/crash.js";
import * as metro from "../lib/metro.js";

type HandlerFn = (a: Record<string, unknown>) => Promise<{ isError?: true; content: Array<{ type: string; text: string }> }>;

async function build() {
  const { registerValidateTools } = await import("./validate.js");
  const h = new Map<string, HandlerFn>();
  registerValidateTools({ tool: (n: string, _d: string, _s: unknown, fn: HandlerFn) => h.set(n, fn) } as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
  return h.get("validate_flow")!;
}

describe("validate_flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(crash, "listCrashes").mockResolvedValue([]);
    // default: no RN app connected → metro checks skipped
    vi.spyOn(metro, "listMetroApps").mockResolvedValue({ error: "metro not running on port 8081" });
  });

  it("ok:true when all assertions pass + no crash + metro skipped", async () => {
    vi.spyOn(oracle, "checkVisible").mockResolvedValue({ visible: true, via: "native-a11y" });
    const fn = await build();
    const res = await fn({ udid: "U", assertions: [{ kind: "visible", text: "Welcome" }] });
    const p = JSON.parse(res.content[0].text) as { ok: boolean; assertions: Array<{ pass: boolean }>; autoChecks: Array<{ name: string; skipped?: boolean }> };
    expect(p.ok).toBe(true);
    expect(p.assertions[0].pass).toBe(true);
    expect(p.autoChecks.find((c) => c.name === "metro")?.skipped).toBe(true);
  });

  it("ok:false when an assertion fails", async () => {
    vi.spyOn(oracle, "checkVisible").mockResolvedValue({ visible: false, via: "native-a11y" });
    const fn = await build();
    const res = await fn({ udid: "U", assertions: [{ kind: "visible", text: "Welcome" }] });
    expect(JSON.parse(res.content[0].text).ok).toBe(false);
  });

  it("ok:false when a recent crash is present (even if assertions pass)", async () => {
    vi.spyOn(oracle, "checkVisible").mockResolvedValue({ visible: true, via: "native-a11y" });
    vi.spyOn(crash, "listCrashes").mockResolvedValue([{ id: "App-2026.ips", path: "/x", processName: "App", mtimeMs: 1 } as unknown as Awaited<ReturnType<typeof crash.listCrashes>>[number]]);
    const fn = await build();
    const res = await fn({ udid: "U", assertions: [{ kind: "visible", text: "Welcome" }] });
    const p = JSON.parse(res.content[0].text) as { ok: boolean; autoChecks: Array<{ name: string; ok: boolean }> };
    expect(p.ok).toBe(false);
    expect(p.autoChecks.find((c) => c.name === "crashes")?.ok).toBe(false);
  });

  it("ok:false when a connected app has a failed (≥400) request", async () => {
    vi.spyOn(oracle, "checkVisible").mockResolvedValue({ visible: true, via: "native-a11y" });
    vi.spyOn(metro, "listMetroApps").mockResolvedValue([{ id: "1", title: "App", description: "", webSocketDebuggerUrl: "ws://x" }]);
    vi.spyOn(metro, "readNetwork").mockResolvedValue({ requests: [{ requestId: "1", url: "https://x/y", method: "GET", status: 500, ts: 1 }] });
    vi.spyOn(metro, "readConsoleLogs").mockResolvedValue({ logs: [] });
    const fn = await build();
    const res = await fn({ udid: "U", assertions: [{ kind: "visible", text: "Welcome" }] });
    const p = JSON.parse(res.content[0].text) as { ok: boolean; autoChecks: Array<{ name: string; ok: boolean }> };
    expect(p.ok).toBe(false);
    expect(p.autoChecks.find((c) => c.name === "failedRequests")?.ok).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as exec from "../lib/exec.js";
import * as nativeLib from "../lib/native.js";
import { mapWebviewNetRecords, mapResourceRecords, mergeWebviewNetwork } from "../lib/webview.js";

type HandlerFn = (args: Record<string, unknown>) => Promise<{
  isError?: true;
  content: Array<{ type: string; text: string }>;
}>;

function makeFakeServer() {
  const handlers = new Map<string, HandlerFn>();
  return {
    handlers,
    tool(name: string, _d: string, _s: unknown, handler: HandlerFn) {
      handlers.set(name, handler);
    },
  };
}

async function buildServer() {
  const { registerWebviewTools } = await import("./webview.js");
  const fake = makeFakeServer();
  registerWebviewTools(fake as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
  return fake;
}

describe("webview isInspectable handling (V2-4)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("webview_inspect returns an actionable error when no inspectable WebView is found", async () => {
    // mobilecli resolves, but the webview list comes back empty.
    vi.spyOn(nativeLib, "resolveMobilecli").mockResolvedValue("/fake/mobilecli");
    vi.spyOn(exec, "run").mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ status: "ok", data: [] }),
      stderr: "",
    });

    const fake = await buildServer();
    const res = await fake.handlers.get("webview_inspect")!({ udid: "U" });

    expect(res.isError).toBe(true);
    const text = res.content[0].text;
    expect(text).toMatch(/isInspectable=false/);
    expect(text).toMatch(/debug or\s+staging|debug\/staging|staging build/i);
    expect(text).toMatch(/tap_on|tap_with_fallback/);
  });

  it("surfaces mobilecli's WebDriverAgent/DeviceKit error actionably (not 'unparseable')", async () => {
    vi.spyOn(nativeLib, "resolveMobilecli").mockResolvedValue("/fake/mobilecli");
    // mobilecli's real error envelope when its WebView backend isn't ready:
    vi.spyOn(exec, "run").mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ status: "error", error: "webview list failed: requires DeviceKit to be running — timed out waiting for WebDriverAgent" }),
      stderr: "",
    });
    const fake = await buildServer();
    const res = await fake.handlers.get("webview_inspect")!({ udid: "U" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/WebDriverAgent|DeviceKit/);
    expect(res.content[0].text).not.toMatch(/unparseable/);
  });

  it("webview_eval surfaces the same actionable error when no WebView is inspectable", async () => {
    vi.spyOn(nativeLib, "resolveMobilecli").mockResolvedValue("/fake/mobilecli");
    vi.spyOn(exec, "run").mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ status: "ok", data: [] }),
      stderr: "",
    });

    const fake = await buildServer();
    const res = await fake.handlers.get("webview_eval")!({ udid: "U", expression: "location.href" });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/isInspectable=false/);
  });
});

describe("webview_network capture", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.PODIUM_DISABLE_WEBVIEW_EVAL;
  });

  it("mapWebviewNetRecords maps shim records to NetworkEntry (pure)", () => {
    const entries = mapWebviewNetRecords([
      { u: "https://x/api", m: "POST", s: 201, st: "Created", ct: "application/json", d: 50, w: 123, q: { A: "1" }, h: { B: "2" }, b: "body" },
      { u: "https://x/ping", m: "GET" },
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      requestId: "0",
      url: "https://x/api",
      method: "POST",
      status: 201,
      statusText: "Created",
      mimeType: "application/json",
      wallTime: 123,
      requestHeaders: { A: "1" },
      responseHeaders: { B: "2" },
      postData: "body",
      timing: { sendStart: 0, sendEnd: 0, receiveHeadersEnd: 50 },
    });
    // sparse record → no optional fields leak in
    expect(entries[1]).toMatchObject({ url: "https://x/ping", method: "GET" });
    expect(entries[1].status).toBeUndefined();
    expect(entries[1].timing).toBeUndefined();
  });

  it("mapResourceRecords maps Performance Resource Timing entries (pure)", () => {
    const out = mapResourceRecords([
      { u: "https://x/app.js", it: "script", d: 30, sz: 1200, st: 200, w: 1718000000 },
      { u: "", it: "img" }, // empty URL dropped
      { it: "css" }, // no URL dropped
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ url: "https://x/app.js", method: "GET", status: 200, mimeType: "script", wallTime: 1718000000, encodedDataLength: 1200 });
  });

  it("mergeWebviewNetwork keeps rich fetch/XHR records and adds non-duplicate resources", () => {
    const merged = mergeWebviewNetwork(
      [{ u: "https://x/api/balance", m: "GET", s: 200, q: { Authorization: "secret" } }],
      [
        { u: "https://x/api/balance", it: "fetch", d: 40 }, // dup of the rich XHR record → dropped
        { u: "https://x/main.css", it: "css", d: 12 }, // unique resource → kept
        { u: "https://x/logo.png", it: "img", d: 8 }, // unique resource → kept
      ]
    );
    expect(merged).toHaveLength(3);
    const balance = merged.find((e) => e.url === "https://x/api/balance")!;
    expect(balance.requestHeaders).toEqual({ Authorization: "secret" }); // the rich record won (has headers)
    expect(merged.some((e) => e.url === "https://x/main.css")).toBe(true);
    expect(merged.some((e) => e.url === "https://x/logo.png")).toBe(true);
    // only one balance entry (deduped)
    expect(merged.filter((e) => e.url === "https://x/api/balance")).toHaveLength(1);
  });

  const RECORDS = [
    {
      u: "https://api.thewinzone.com/v1/balance?cur=SC",
      m: "GET",
      q: { Authorization: "Bearer secret-token-xyz", Accept: "application/json" },
      s: 200,
      st: "OK",
      h: { "Content-Type": "application/json", "Set-Cookie": "sid=secret-cookie" },
      ct: "application/json",
      d: 82,
      w: 1718000000,
    },
    {
      u: "https://api.thewinzone.com/v1/redeem",
      m: "POST",
      q: { Authorization: "Bearer secret-token-xyz", "Content-Type": "application/json" },
      b: '{"amount":5}',
      s: 500,
      d: 211,
      w: 1718000001,
    },
  ];

  /** Mock mobilecli: `webview list` → one inspectable view; `webview eval` →
   *  'installed' for the shim, the records buffer for the read-back expression. */
  function mockMobilecli(records: unknown = RECORDS) {
    vi.spyOn(nativeLib, "resolveMobilecli").mockResolvedValue("/fake/mobilecli");
    vi.spyOn(exec, "run").mockImplementation(async (_bin: string, args: string[]) => {
      if (args[1] === "list") {
        return {
          code: 0,
          stdout: JSON.stringify({
            status: "ok",
            data: [{ id: "wv1", url: "https://app", title: "App", bounds: { x: 0, y: 0, width: 390, height: 844 }, isVisible: true }],
          }),
          stderr: "",
        };
      }
      if (args[1] === "eval") {
        const expr = args[3] ?? "";
        if (expr.startsWith("JSON.stringify(window.__podiumNet")) {
          return { code: 0, stdout: JSON.stringify({ status: "ok", data: JSON.stringify(records) }), stderr: "" };
        }
        return { code: 0, stdout: JSON.stringify({ status: "ok", data: "installed" }), stderr: "" };
      }
      return { code: 1, stdout: "", stderr: `unexpected args ${JSON.stringify(args)}` };
    });
  }

  it("captures fetch/XHR records and emits a redacted HAR by default", async () => {
    mockMobilecli();
    const fake = await buildServer();
    const res = await fake.handlers.get("webview_network")!({ udid: "U", format: "har", durationMs: 100 });

    expect(res.isError).toBeUndefined();
    const text = res.content[0].text;
    // no secret survives redaction-by-default
    expect(text).not.toMatch(/secret-token-xyz/);
    expect(text).not.toMatch(/secret-cookie/);

    const payload = JSON.parse(text) as { redacted: boolean; count: number; har: { log: { entries: Array<Record<string, unknown>> } } };
    expect(payload.redacted).toBe(true);
    expect(payload.count).toBe(2);
    const entries = payload.har.log.entries;
    expect(entries).toHaveLength(2);

    const authHdr = (entries[0].request as { headers: Array<{ name: string; value: string }> }).headers.find((h) => h.name === "Authorization");
    expect(authHdr!.value).toBe("***REDACTED***");
    const setCookie = (entries[0].response as { headers: Array<{ name: string; value: string }> }).headers.find((h) => h.name === "Set-Cookie");
    expect(setCookie!.value).toBe("***REDACTED***");
    expect((entries[1].request as { postData?: { text: string } }).postData!.text).toBe("***REDACTED***");
    expect((entries[0].request as { method: string }).method).toBe("GET");
    expect((entries[0].response as { status: number }).status).toBe(200);
  });

  it("redact:false keeps secrets (opt-out)", async () => {
    mockMobilecli();
    const fake = await buildServer();
    const res = await fake.handlers.get("webview_network")!({ udid: "U", format: "json", redact: false, durationMs: 100 });
    expect(res.isError).toBeUndefined();
    const payload = JSON.parse(res.content[0].text) as { redacted: boolean; requests: Array<{ requestHeaders?: Record<string, string> }> };
    expect(payload.redacted).toBe(false);
    expect(payload.requests[0].requestHeaders!.Authorization).toBe("Bearer secret-token-xyz");
  });

  it("is gated by PODIUM_DISABLE_WEBVIEW_EVAL", async () => {
    process.env.PODIUM_DISABLE_WEBVIEW_EVAL = "1";
    const fake = await buildServer();
    const res = await fake.handlers.get("webview_network")!({ udid: "U" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/PODIUM_DISABLE_WEBVIEW_EVAL/);
  });

  it("surfaces the no-inspectable-WebView error", async () => {
    vi.spyOn(nativeLib, "resolveMobilecli").mockResolvedValue("/fake/mobilecli");
    vi.spyOn(exec, "run").mockResolvedValue({ code: 0, stdout: JSON.stringify({ status: "ok", data: [] }), stderr: "" });
    const fake = await buildServer();
    const res = await fake.handlers.get("webview_network")!({ udid: "U" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/isInspectable=false/);
  });
});

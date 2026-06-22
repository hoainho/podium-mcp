import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import * as exec from "../lib/exec.js";
import * as metro from "../lib/metro.js";
import * as crash from "../lib/crash.js";

// ─── Minimal typed fake server ────────────────────────────────────────────────
type HandlerFn = (args: Record<string, unknown>) => Promise<{
  isError?: true;
  content: Array<{ type: string; text: string }>;
}>;

interface FakeServer {
  _handlers: Map<string, HandlerFn>;
  tool(
    name: string,
    description: string,
    schema: Record<string, unknown>,
    handler: HandlerFn
  ): void;
}

function makeFakeServer(): FakeServer {
  const _handlers = new Map<string, HandlerFn>();
  return {
    _handlers,
    tool(name, _description, _schema, handler) {
      _handlers.set(name, handler);
    },
  };
}

async function buildServer() {
  const { registerDebugTools } = await import("./debug.js");
  const fake = makeFakeServer();
  registerDebugTools(
    fake as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer
  );
  return fake;
}

// ─── app_state tests ──────────────────────────────────────────────────────────

describe("app_state", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // app_state resolves `installed` via listApps() (xcrun listapps → plutil → JSON),
  // so the mock must satisfy both the listapps and plutil calls, plus launchctl.
  function mockAppState(opts: {
    apps: Record<string, { CFBundleDisplayName?: string }>;
    launchctlStdout: string;
    listappsCode?: number;
  }) {
    vi.spyOn(exec, "run").mockImplementation(async (cmd, args) => {
      if (cmd === "xcrun" && args.includes("listapps")) {
        return { code: opts.listappsCode ?? 0, stdout: "FAKE_PLIST", stderr: "" };
      }
      if (cmd === "plutil") {
        return { code: 0, stdout: JSON.stringify(opts.apps), stderr: "" };
      }
      // xcrun simctl spawn <udid> launchctl list
      return { code: 0, stdout: opts.launchctlStdout, stderr: "" };
    });
  }

  it("returns installed:true running:true when both commands confirm the app", async () => {
    mockAppState({
      apps: { "com.example.MyApp": { CFBundleDisplayName: "My App" } },
      launchctlStdout: "- 0 UIKitApplication:com.example.MyApp[0x1234]",
    });

    const fake = await buildServer();
    const handler = fake._handlers.get("app_state");
    expect(handler).toBeDefined();

    const response = await handler!({
      udid: "74DD7D29-38BC-4B82-B92A-FFA7E0C15F74",
      bundleId: "com.example.MyApp",
    });

    expect(response.isError).toBeUndefined();
    const payload = JSON.parse(response.content[0].text) as {
      installed: boolean;
      running: boolean;
    };
    expect(payload.installed).toBe(true);
    expect(payload.running).toBe(true);
  });

  it("returns installed:true running:false when app is installed but not running", async () => {
    mockAppState({
      apps: { "com.example.MyApp": {} },
      launchctlStdout: "- 0 UIKitApplication:com.other.app[0x1234]",
    });

    const fake = await buildServer();
    const handler = fake._handlers.get("app_state")!;
    const response = await handler!({
      udid: "74DD7D29-38BC-4B82-B92A-FFA7E0C15F74",
      bundleId: "com.example.MyApp",
    });

    const payload = JSON.parse(response.content[0].text) as {
      installed: boolean;
      running: boolean;
    };
    expect(payload.installed).toBe(true);
    expect(payload.running).toBe(false);
  });

  it("returns installed:false running:false when app is absent", async () => {
    mockAppState({
      apps: { "com.other.app": {} },
      launchctlStdout: "- 0 UIKitApplication:com.other.app[0x1]",
    });

    const fake = await buildServer();
    const handler = fake._handlers.get("app_state")!;
    const response = await handler!({
      udid: "74DD7D29-38BC-4B82-B92A-FFA7E0C15F74",
      bundleId: "com.example.MyApp",
    });

    const payload = JSON.parse(response.content[0].text) as {
      installed: boolean;
      running: boolean;
    };
    expect(payload.installed).toBe(false);
    expect(payload.running).toBe(false);
  });

  it("returns installed:false when listapps fails", async () => {
    mockAppState({
      apps: {},
      launchctlStdout: "",
      listappsCode: 1,
    });

    const fake = await buildServer();
    const handler = fake._handlers.get("app_state")!;
    const response = await handler!({
      udid: "NONEXISTENT",
      bundleId: "com.example.MyApp",
    });

    const payload = JSON.parse(response.content[0].text) as {
      installed: boolean;
      running: boolean;
    };
    expect(payload.installed).toBe(false);
    expect(payload.running).toBe(false);
  });

  // Q1 regression: a prefix bundle id must NOT be reported as installed/running
  // when only a longer id sharing that prefix is present.
  it("does not false-positive when queried id is a prefix of a different app", async () => {
    mockAppState({
      apps: { "com.example.AppExtension": { CFBundleDisplayName: "Ext" } },
      launchctlStdout: "- 0 UIKitApplication:com.example.AppExtension[0x9]",
    });

    const fake = await buildServer();
    const handler = fake._handlers.get("app_state")!;
    const response = await handler!({
      udid: "74DD7D29-38BC-4B82-B92A-FFA7E0C15F74",
      bundleId: "com.example.App",
    });

    const payload = JSON.parse(response.content[0].text) as {
      installed: boolean;
      running: boolean;
    };
    expect(payload.installed).toBe(false);
    expect(payload.running).toBe(false);
  });
});

// ─── metro_network tests (V2-2) ───────────────────────────────────────────────

describe("foldNetworkEvents", () => {
  it("merges requestWillBeSent + responseReceived by requestId", () => {
    const entries = metro.foldNetworkEvents([
      {
        method: "Network.requestWillBeSent",
        params: { requestId: "1", timestamp: 100, request: { url: "https://api.test/x", method: "POST" } },
      },
      {
        method: "Network.responseReceived",
        params: { requestId: "1", response: { status: 200, mimeType: "application/json" } },
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      requestId: "1",
      url: "https://api.test/x",
      method: "POST",
      status: 200,
      mimeType: "application/json",
      ts: 100,
    });
  });

  it("captures richer HAR fields (headers, timing, wallTime, postData)", () => {
    const entries = metro.foldNetworkEvents([
      {
        method: "Network.requestWillBeSent",
        params: {
          requestId: "9",
          timestamp: 1,
          wallTime: 1700,
          request: { url: "https://api.test/x", method: "POST", headers: { Authorization: "Bearer T" }, postData: "{}" },
        },
      },
      {
        method: "Network.responseReceived",
        params: {
          requestId: "9",
          response: { status: 200, mimeType: "application/json", headers: { "Set-Cookie": "a=b" }, timing: { dnsStart: 0, dnsEnd: 2 }, encodedDataLength: 50 },
        },
      },
    ]);
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.requestHeaders?.Authorization).toBe("Bearer T");
    expect(e.responseHeaders?.["Set-Cookie"]).toBe("a=b");
    expect(e.timing?.dnsEnd).toBe(2);
    expect(e.wallTime).toBe(1700);
    expect(e.postData).toBe("{}");
  });

  it("keeps distinct requestIds separate and tolerates response-before-request", () => {
    const entries = metro.foldNetworkEvents([
      { method: "Network.responseReceived", params: { requestId: "2", response: { status: 404, url: "https://api.test/y" } } },
      { method: "Network.requestWillBeSent", params: { requestId: "3", timestamp: 5, request: { url: "https://api.test/z", method: "GET" } } },
    ]);
    expect(entries).toHaveLength(2);
    const r2 = entries.find((e) => e.requestId === "2");
    expect(r2?.status).toBe(404);
    const r3 = entries.find((e) => e.requestId === "3");
    expect(r3?.method).toBe("GET");
    expect(r3?.status).toBeUndefined(); // never responded in window
  });
});

describe("metro_network tool", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns count + requests from readNetwork when a ws url is given", async () => {
    vi.spyOn(metro, "readNetwork").mockResolvedValue({
      requests: [
        { requestId: "1", url: "https://api.test/a", method: "GET", status: 200, mimeType: "application/json", ts: 1 },
      ],
    });

    const fake = await buildServer();
    const handler = fake._handlers.get("metro_network")!;
    const res = await handler({ webSocketDebuggerUrl: "ws://localhost:8081/x" });
    expect(res.isError).toBeUndefined();
    const payload = JSON.parse(res.content[0].text) as { count: number; requests: Array<{ status: number }> };
    expect(payload.count).toBe(1);
    expect(payload.requests[0].status).toBe(200);
  });

  it("returns a structured error when readNetwork fails", async () => {
    vi.spyOn(metro, "readNetwork").mockResolvedValue({ error: "WebSocket connection failed" });
    const fake = await buildServer();
    const handler = fake._handlers.get("metro_network")!;
    const res = await handler({ webSocketDebuggerUrl: "ws://localhost:8081/x" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("WebSocket connection failed");
  });

  it("DEFAULT format:'json' also redacts sensitive headers + postData (no token survives)", async () => {
    vi.spyOn(metro, "readNetwork").mockResolvedValue({
      requests: [
        {
          requestId: "1",
          url: "https://api.test/a",
          method: "POST",
          status: 200,
          ts: 1,
          requestHeaders: { Authorization: "Bearer LEAK", Accept: "*/*" },
          responseHeaders: { "Set-Cookie": "sid=SECRET" },
          postData: "password=hunter2",
        },
      ],
    });
    const fake = await buildServer();
    const res = await fake._handlers.get("metro_network")!({ webSocketDebuggerUrl: "ws://localhost:8081/x" });
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).not.toContain("LEAK");
    expect(res.content[0].text).not.toContain("SECRET");
    expect(res.content[0].text).not.toContain("hunter2");
    const payload = JSON.parse(res.content[0].text) as { redacted: boolean; requests: Array<{ requestHeaders: Record<string, string> }> };
    expect(payload.redacted).toBe(true);
    expect(payload.requests[0].requestHeaders.Accept).toBe("*/*"); // non-sensitive preserved
  });

  it("format:'har' emits a redacted HAR 1.2 log (no token survives)", async () => {
    vi.spyOn(metro, "readNetwork").mockResolvedValue({
      requests: [
        {
          requestId: "1",
          url: "https://api.test/a",
          method: "GET",
          status: 200,
          mimeType: "application/json",
          ts: 1,
          requestHeaders: { Authorization: "Bearer LEAK" },
        },
      ],
    });
    const fake = await buildServer();
    const handler = fake._handlers.get("metro_network")!;
    const res = await handler({ webSocketDebuggerUrl: "ws://localhost:8081/x", format: "har" });
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).not.toContain("LEAK");
    const payload = JSON.parse(res.content[0].text) as { format: string; redacted: boolean; har: { log: { version: string } } };
    expect(payload.format).toBe("har");
    expect(payload.redacted).toBe(true);
    expect(payload.har.log.version).toBe("1.2");
  });
});

// ─── metro_state tests (V2-8) ──────────────────────────────────────────────────

describe("parseEvalResponse", () => {
  it("extracts a returnByValue value", () => {
    expect(metro.parseEvalResponse({ result: { result: { value: { count: 3 } } } })).toEqual({
      value: { count: 3 },
    });
  });
  it("falls back to description when no value", () => {
    expect(metro.parseEvalResponse({ result: { result: { description: "fn() {}" } } })).toEqual({
      value: "fn() {}",
    });
  });
  it("returns an error on exceptionDetails", () => {
    const r = metro.parseEvalResponse({ result: { exceptionDetails: { text: "ReferenceError: store" } } });
    expect("error" in r && r.error).toMatch(/ReferenceError/);
  });
});

describe("metro_state tool", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns the evaluated value", async () => {
    vi.spyOn(metro, "evalRuntime").mockResolvedValue({ value: { user: { id: 1 } } });
    const fake = await buildServer();
    const res = await fake._handlers.get("metro_state")!({
      webSocketDebuggerUrl: "ws://localhost:8081/x",
      expression: "store.getState()",
    });
    expect(res.isError).toBeUndefined();
    const payload = JSON.parse(res.content[0].text) as { value: { user: { id: number } }; expression: string };
    expect(payload.value.user.id).toBe(1);
    expect(payload.expression).toBe("store.getState()");
  });

  it("returns a structured error when evaluation fails", async () => {
    vi.spyOn(metro, "evalRuntime").mockResolvedValue({ error: "Runtime.evaluate timed out after 5000ms" });
    const fake = await buildServer();
    const res = await fake._handlers.get("metro_state")!({ webSocketDebuggerUrl: "ws://localhost:8081/x" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("timed out");
  });
});

// ─── crash listing tests ──────────────────────────────────────────────────────

describe("crash_list against tmp dir", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), "podium-crash-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("lists .ips and .crash files sorted newest first", async () => {
    // Write two files with different content
    await writeFile(join(tmpDir, "MyApp-2024-01-10-123000.ips"), '{"app_name":"MyApp"}\nbody\n');
    await writeFile(join(tmpDir, "OtherApp-2024-01-12-090000.crash"), "Thread 0 Crashed\n");

    // Give OtherApp a newer mtime
    const { utimes } = await import("node:fs/promises");
    const now = new Date();
    const older = new Date(now.getTime() - 60_000);
    await utimes(join(tmpDir, "MyApp-2024-01-10-123000.ips"), older, older);
    await utimes(join(tmpDir, "OtherApp-2024-01-12-090000.crash"), now, now);

    const entries = await crash.listCrashes(undefined, tmpDir);
    expect(entries.length).toBe(2);
    expect(entries[0].id).toBe("OtherApp-2024-01-12-090000.crash");
    expect(entries[1].id).toBe("MyApp-2024-01-10-123000.ips");
  });

  it("filters by processName case-insensitively", async () => {
    await writeFile(join(tmpDir, "myapp-2024-03-01-120000.ips"), '{"app_name":"myapp"}\nbody');
    await writeFile(join(tmpDir, "OtherApp-2024-03-01-120000.ips"), '{"app_name":"OtherApp"}\nbody');

    const entries = await crash.listCrashes({ processName: "myapp" }, tmpDir);
    expect(entries.length).toBe(1);
    expect(entries[0].id).toBe("myapp-2024-03-01-120000.ips");
  });

  it("returns empty array for a dir with no crash files", async () => {
    await writeFile(join(tmpDir, "readme.txt"), "not a crash");
    const entries = await crash.listCrashes(undefined, tmpDir);
    expect(entries).toHaveLength(0);
  });

  it("returns empty array when dir does not exist", async () => {
    const entries = await crash.listCrashes(undefined, join(tmpDir, "nonexistent"));
    expect(entries).toHaveLength(0);
  });

  it("sinceHours filter excludes old files", async () => {
    await writeFile(join(tmpDir, "OldApp-2020-01-01-000000.ips"), '{"app_name":"OldApp"}\nbody');
    const { utimes } = await import("node:fs/promises");
    const veryOld = new Date(Date.now() - 48 * 3600 * 1000); // 48h ago
    await utimes(join(tmpDir, "OldApp-2020-01-01-000000.ips"), veryOld, veryOld);

    const entries = await crash.listCrashes({ sinceHours: 1 }, tmpDir);
    expect(entries).toHaveLength(0);
  });
});

// ─── crash_get path-traversal tests ──────────────────────────────────────────

describe("crash_get path-traversal safety", () => {
  it("rejects id with path separators", async () => {
    const result = await crash.getCrash("../../etc/passwd");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("invalid crash id");
    }
  });

  it("rejects id with .crash or .ips extension in a path", async () => {
    const result = await crash.getCrash("../other/file.ips");
    expect("error" in result).toBe(true);
  });

  it("rejects id with no valid extension", async () => {
    const result = await crash.getCrash("somefile.txt");
    expect("error" in result).toBe(true);
  });

  it("returns a parsed report for a valid .ips file in a tmp dir", async () => {
    const tmpDir = await mkdtemp(join(os.tmpdir(), "podium-crash-get-"));
    try {
      const header = { app_name: "TestApp", os_version: "macOS 14.0" };
      const body = "Thread 0 Crashed:\n  0  libsystem\n";
      const filename = "TestApp-2024-06-01-120000.ips";
      await writeFile(join(tmpDir, filename), JSON.stringify(header) + "\n" + body);

      const result = await crash.getCrash(filename, tmpDir);
      expect("error" in result).toBe(false);
      if (!("error" in result)) {
        expect(result.header).toMatchObject({ app_name: "TestApp" });
        expect(result.body).toContain("Thread 0 Crashed");
        expect(result.truncated).toBe(false);
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("sets truncated:true when body exceeds 8000 chars", async () => {
    const tmpDir = await mkdtemp(join(os.tmpdir(), "podium-crash-trunc-"));
    try {
      const longBody = "x".repeat(9000);
      const filename = "BigApp-2024-06-01-120000.ips";
      await writeFile(join(tmpDir, filename), '{"app_name":"BigApp"}\n' + longBody);

      const result = await crash.getCrash(filename, tmpDir);
      expect("error" in result).toBe(false);
      if (!("error" in result)) {
        expect(result.truncated).toBe(true);
        expect(result.body.length).toBe(8000);
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── metro_apps connection-refused structured error ───────────────────────────

describe("metro_apps", () => {
  it("returns structured error when connecting to an unused localhost port", async () => {
    // Port 19999 is very unlikely to be in use; if it is, test still passes
    // since we just check for the error shape.
    const result = await metro.listMetroApps(19999);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/metro not running on port 19999/);
    }
  });

  it("returns structured error when metro_apps tool handler is called on unused port", async () => {
    const fake = await buildServer();
    const handler = fake._handlers.get("metro_apps")!;
    const response = await handler!({ port: 19999 });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("metro not running");
  });

  it("parses a valid /json response into MetroApp array", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: "abc123",
          description: "React Native Debugger",
          title: "ExampleApp",
          webSocketDebuggerUrl: "ws://localhost:8081/inspector/debug?device=1&page=1",
        },
      ],
    } as unknown as Response);

    const result = await metro.listMetroApps(8081);
    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("ExampleApp");
      expect(result[0].webSocketDebuggerUrl).toContain("ws://");
    }
  });
});

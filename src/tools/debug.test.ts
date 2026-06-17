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

  it("returns installed:true running:true when both commands confirm the app", async () => {
    vi.spyOn(exec, "run").mockImplementation(async (_cmd, args) => {
      if (args.includes("listapps")) {
        return {
          code: 0,
          stdout: `{ "com.example.MyApp": { "CFBundleIdentifier": "com.example.MyApp" } }`,
          stderr: "",
        };
      }
      // launchctl list
      return {
        code: 0,
        stdout: `- 0 UIKitApplication:com.example.MyApp[0x1234]`,
        stderr: "",
      };
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
    vi.spyOn(exec, "run").mockImplementation(async (_cmd, args) => {
      if (args.includes("listapps")) {
        return {
          code: 0,
          stdout: `com.example.MyApp`,
          stderr: "",
        };
      }
      return { code: 0, stdout: "- 0 SomeOtherApp[0x1234]", stderr: "" };
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
    vi.spyOn(exec, "run").mockResolvedValue({
      code: 0,
      stdout: "com.other.app",
      stderr: "",
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
    vi.spyOn(exec, "run").mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "Device not found",
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

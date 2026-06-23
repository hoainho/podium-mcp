import { describe, it, expect, vi, afterEach } from "vitest";
import * as exec from "../lib/exec.js";
import { registerEngineTools, _setEngineTransportFactory } from "./engine.js";
import type { EngineTransport, EngineResponse } from "../lib/engine.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type Handler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ text: string }>;
}>;

function makeFakeServer() {
  const handlers = new Map<string, Handler>();
  return {
    _handlers: handlers,
    tool(name: string, _desc: string, _schema: unknown, handler: Handler) {
      handlers.set(name, handler);
    },
  };
}

function build() {
  const fake = makeFakeServer();
  registerEngineTools(fake as unknown as McpServer);
  return fake;
}

function mockTransport(responder: (cmd: Record<string, unknown>) => EngineResponse): EngineTransport {
  return { send: async (cmd) => responder(cmd), close: async () => {} };
}

describe("engine tools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    _setEngineTransportFactory(null);
  });

  it("engine_inspect returns objects with screen coords (no vision)", async () => {
    vi.spyOn(exec, "run").mockResolvedValue({ code: 0, stdout: "", stderr: "" }); // port forward ok
    _setEngineTransportFactory(async () =>
      mockTransport((cmd) =>
        cmd.commandName === "findObjects"
          ? { data: [{ name: "PlayButton", id: 7, x: 540, y: 1200 }] }
          : { data: "ok" }
      )
    );
    const fake = build();
    const res = await fake._handlers.get("engine_inspect")!({ udid: "emulator-5554", value: "PlayButton" });
    expect(res.isError).toBeUndefined();
    const payload = JSON.parse(res.content[0].text) as {
      count: number;
      objects: Array<{ name: string; x: number; y: number }>;
    };
    expect(payload.count).toBe(1);
    expect(payload.objects[0]).toMatchObject({ name: "PlayButton", x: 540, y: 1200 });
  });

  it("engine_tap finds then taps the first match", async () => {
    vi.spyOn(exec, "run").mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    const sent: Record<string, unknown>[] = [];
    _setEngineTransportFactory(async () => ({
      send: async (cmd) => {
        sent.push(cmd);
        return cmd.commandName === "findObjects"
          ? { data: [{ name: "B", id: 9, x: 100, y: 200 }] }
          : { data: "ok" };
      },
      close: async () => {},
    }));
    const fake = build();
    const res = await fake._handlers.get("engine_tap")!({ udid: "emulator-5554", value: "B" });
    expect(res.isError).toBeUndefined();
    expect(sent.some((c) => c.commandName === "tapObject" && c.id === 9)).toBe(true);
  });

  it("engine_tap returns an error when no object matches", async () => {
    vi.spyOn(exec, "run").mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    _setEngineTransportFactory(async () => mockTransport(() => ({ data: [] })));
    const fake = build();
    const res = await fake._handlers.get("engine_tap")!({ udid: "emulator-5554", value: "Nope" });
    expect(res.isError).toBe(true);
  });

  it("fails closed with an actionable error when no AltTester server is reachable", async () => {
    vi.spyOn(exec, "run").mockResolvedValue({ code: 0, stdout: "", stderr: "" }); // forward ok
    _setEngineTransportFactory(async () => {
      throw new Error("ECONNREFUSED");
    });
    const fake = build();
    const res = await fake._handlers.get("engine_inspect")!({ udid: "emulator-5554", value: "X" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/AltTester-instrumented build/i);
  });

  it("fails closed when the port-forward fails", async () => {
    vi.spyOn(exec, "run").mockResolvedValue({ code: 1, stdout: "", stderr: "no device" });
    _setEngineTransportFactory(async () => mockTransport(() => ({ data: [] })));
    const fake = build();
    const res = await fake._handlers.get("engine_inspect")!({ udid: "emulator-5554", value: "X" });
    expect(res.isError).toBe(true);
  });
});

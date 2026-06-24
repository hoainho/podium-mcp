import { describe, it, expect, vi, afterEach } from "vitest";
import * as exec from "./exec.js";
import {
  EngineClient,
  EngineError,
  parseEngineObjects,
  forwardEnginePort,
  createWebviewEngineTransport,
  type EngineTransport,
  type EngineResponse,
} from "./engine.js";

function mockTransport(responder: (cmd: Record<string, unknown>) => EngineResponse) {
  const sent: Record<string, unknown>[] = [];
  const transport: EngineTransport = {
    send: async (cmd) => {
      sent.push(cmd);
      return responder(cmd);
    },
    close: async () => {},
  };
  return { transport, sent };
}

describe("parseEngineObjects", () => {
  it("parses an array of objects carrying screen coords", () => {
    expect(
      parseEngineObjects([{ name: "PlayButton", id: 5, x: 540, y: 1200, enabled: true, type: "Button" }])
    ).toEqual([{ name: "PlayButton", id: 5, x: 540, y: 1200, enabled: true, type: "Button" }]);
  });

  it("accepts a JSON-string payload (AltTester sometimes double-encodes)", () => {
    expect(parseEngineObjects(JSON.stringify([{ name: "X", id: 1, x: 10, y: 20 }]))).toEqual([
      { name: "X", id: 1, x: 10, y: 20 },
    ]);
  });

  it("drops objects without finite screen coords (untappable without vision)", () => {
    expect(parseEngineObjects([{ name: "NoCoords", id: 2 }, { name: "Ok", id: 3, x: 1, y: 2 }])).toEqual([
      { name: "Ok", id: 3, x: 1, y: 2 },
    ]);
  });

  it("returns [] on non-array or unparseable input", () => {
    expect(parseEngineObjects("not json")).toEqual([]);
    expect(parseEngineObjects(42)).toEqual([]);
  });
});

describe("EngineClient", () => {
  it("findObjects builds the command and returns tap-ready objects", async () => {
    const { transport, sent } = mockTransport(() => ({ data: [{ name: "PlayButton", id: 7, x: 540, y: 1200 }] }));
    const els = await new EngineClient(transport).findObjects("name", "PlayButton");
    expect(sent[0]).toEqual({ commandName: "findObjects", by: "name", value: "PlayButton" });
    expect(els).toEqual([{ name: "PlayButton", id: 7, x: 540, y: 1200 }]);
  });

  it("tap sends tapObject with id + screen coords", async () => {
    const { transport, sent } = mockTransport(() => ({ data: "ok" }));
    await new EngineClient(transport).tap({ name: "B", id: 7, x: 540, y: 1200 });
    expect(sent[0]).toEqual({ commandName: "tapObject", id: 7, x: 540, y: 1200 });
  });

  it("callComponentMethod forwards component/method/parameters (DOM-event analog)", async () => {
    const { transport, sent } = mockTransport(() => ({ data: 42 }));
    const out = await new EngineClient(transport).callComponentMethod(
      { name: "B", id: 7, x: 1, y: 2 },
      "ScoreController",
      "AddPoints",
      [10]
    );
    expect(sent[0]).toEqual({
      commandName: "callComponentMethod",
      id: 7,
      component: "ScoreController",
      method: "AddPoints",
      parameters: [10],
    });
    expect(out).toBe(42);
  });

  it("throws EngineError (fail closed) on a server-reported error", async () => {
    const { transport } = mockTransport(() => ({ error: { type: "NotFound", message: "no object" } }));
    await expect(new EngineClient(transport).findObjects("name", "X")).rejects.toBeInstanceOf(EngineError);
  });
});

describe("forwardEnginePort", () => {
  afterEach(() => vi.restoreAllMocks());

  it("Android forwards via adb", async () => {
    const spy = vi.spyOn(exec, "run").mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    expect(await forwardEnginePort("android", "emulator-5554")).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      "adb",
      ["-s", "emulator-5554", "forward", "tcp:13000", "tcp:13000"],
      expect.anything()
    );
  });

  it("iOS forwards via iproxy", async () => {
    const spy = vi.spyOn(exec, "run").mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    expect(await forwardEnginePort("ios-sim", "SIM-1")).toBe(true);
    expect(spy).toHaveBeenCalledWith("iproxy", ["13000", "13000"], expect.anything());
  });

  it("returns false when the forward command fails (caller fails closed)", async () => {
    vi.spyOn(exec, "run").mockResolvedValue({ code: 1, stdout: "", stderr: "err" });
    expect(await forwardEnginePort("android", "X")).toBe(false);
  });
});

describe("createWebviewEngineTransport (WebGL-in-WebView)", () => {
  it("invokes the window.__podiumEngine bridge and parses the response", async () => {
    const calls: string[] = [];
    const evalJs = async (expr: string) => {
      calls.push(expr);
      return JSON.stringify({ data: [{ name: "Canvas/Play", id: 3, x: 200, y: 400 }] });
    };
    const objs = await new EngineClient(createWebviewEngineTransport(evalJs)).findObjects("path", "Canvas/Play");
    expect(objs).toEqual([{ name: "Canvas/Play", id: 3, x: 200, y: 400 }]);
    expect(calls[0]).toContain("__podiumEngine");
  });

  it("fails closed (EngineError) when the bridge returns non-JSON", async () => {
    const client = new EngineClient(createWebviewEngineTransport(async () => "oops not json"));
    await expect(client.findObjects("name", "X")).rejects.toBeInstanceOf(EngineError);
  });

  it("fails closed (EngineError) when the eval itself throws (no bridge present)", async () => {
    const client = new EngineClient(
      createWebviewEngineTransport(async () => {
        throw new Error("no __podiumEngine bridge");
      })
    );
    await expect(client.findObjects("name", "X")).rejects.toBeInstanceOf(EngineError);
  });
});

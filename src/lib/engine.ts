/**
 * Game-engine bridge core (v0.3.0 story C1) — no-vision element addressing for
 * Unity / WebGL / GL via AltTester.
 *
 * AltTester instruments a Unity build with an in-app server (default TCP 13000)
 * exposing the live scene graph: query GameObjects by name/path/component, read
 * each object's SCREEN coordinates, and drive tap/swipe/drag or call a component
 * method by reflection. This is DOM-like addressing with ZERO screenshots — the
 * token-efficient path the v0.3.0 plan is built on (click/hover/swipe on named
 * objects, like DOM elements).
 *
 * REQUIRES an AltTester-instrumented build (dev/staging) reachable on the
 * forwarded port. Production App Store builds do not ship AltTester — in that
 * case the caller (C2 tools) fails closed with an actionable "enable AltTester"
 * error, never a vision fallback.
 *
 * The wire protocol sits behind EngineTransport so the command-build / response-
 * parse logic is unit-testable without a live server. The concrete socket
 * transport and exact AltTester framing are validated against a live
 * instrumented build (hardware-gated — see prd.json story C4).
 */
import { run } from "./exec.js";
import type { Platform } from "./device-target.js";

export interface EngineObject {
  name: string;
  /** AltTester object handle, used by subsequent commands. */
  id: number;
  /** Absolute screen coordinates (pixels) — feed straight into a tap. */
  x: number;
  y: number;
  enabled?: boolean;
  /** Component / type name when reported. */
  type?: string;
}

export type EngineBy = "name" | "path" | "component" | "text" | "id";

export interface EngineResponse {
  data?: unknown;
  error?: { type: string; message: string } | null;
}

/** One request/response round-trip against the engine server. Injectable for tests. */
export interface EngineTransport {
  send(command: Record<string, unknown>): Promise<EngineResponse>;
  close(): Promise<void>;
}

/** Thrown when the engine bridge cannot serve a request. `actionable` flags the
 * "your build isn't instrumented / server unreachable" case the tools surface. */
export class EngineError extends Error {
  readonly actionable: boolean;
  constructor(message: string, actionable = true) {
    super(message);
    this.name = "EngineError";
    this.actionable = actionable;
  }
}

export const ENGINE_DEFAULT_PORT = 13000;

/**
 * Forward the host port to the in-app AltTester server so the client can reach
 * it: `adb forward` on Android, `iproxy` on iOS (sim or real). Returns whether
 * the forward succeeded; the caller fails closed when it does not.
 */
export async function forwardEnginePort(
  platform: Platform,
  udid: string,
  port = ENGINE_DEFAULT_PORT
): Promise<boolean> {
  if (platform === "android") {
    const r = await run("adb", ["-s", udid, "forward", `tcp:${port}`, `tcp:${port}`], {
      timeout: 10_000,
    });
    return r.code === 0;
  }
  // iOS (sim/real): iproxy <localPort> <devicePort>
  const r = await run("iproxy", [String(port), String(port)], { timeout: 10_000 });
  return r.code === 0;
}

/**
 * Normalize AltTester object payloads into EngineObjects. AltTester returns
 * arrays either as JSON or as a JSON string; both are accepted. Objects without
 * finite screen coordinates are dropped (they cannot be tapped without vision).
 */
export function parseEngineObjects(data: unknown): EngineObject[] {
  let arr: unknown = data;
  if (typeof data === "string") {
    try {
      arr = JSON.parse(data);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr.flatMap((o): EngineObject[] => {
    if (!o || typeof o !== "object") return [];
    const rec = o as Record<string, unknown>;
    const x = Number(rec.x);
    const y = Number(rec.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    return [
      {
        name: typeof rec.name === "string" ? rec.name : "",
        id: Number.isFinite(Number(rec.id)) ? Number(rec.id) : 0,
        x,
        y,
        ...(typeof rec.enabled === "boolean" ? { enabled: rec.enabled } : {}),
        ...(typeof rec.type === "string" ? { type: rec.type } : {}),
      },
    ];
  });
}

/**
 * Typed client over an EngineTransport. Builds AltTester commands and parses
 * responses; throws EngineError on any server-reported error (fail closed).
 */
export class EngineClient {
  constructor(private readonly transport: EngineTransport) {}

  private async cmd(commandName: string, params: Record<string, unknown>): Promise<unknown> {
    const res = await this.transport.send({ commandName, ...params });
    if (res.error) {
      throw new EngineError(`engine ${commandName} failed: ${res.error.type}: ${res.error.message}`, false);
    }
    return res.data;
  }

  /** Find scene objects matching a selector; each carries tap-ready screen coords. */
  async findObjects(by: EngineBy, value: string): Promise<EngineObject[]> {
    return parseEngineObjects(await this.cmd("findObjects", { by, value }));
  }

  async tap(obj: EngineObject): Promise<void> {
    await this.cmd("tapObject", { id: obj.id, x: obj.x, y: obj.y });
  }

  async swipe(
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs = 300
  ): Promise<void> {
    await this.cmd("swipe", {
      startX: from.x,
      startY: from.y,
      endX: to.x,
      endY: to.y,
      duration: durationMs,
    });
  }

  /** Invoke a C# component method by reflection (the engine equivalent of a DOM event handler). */
  async callComponentMethod(
    obj: EngineObject,
    component: string,
    method: string,
    parameters: unknown[] = []
  ): Promise<unknown> {
    return this.cmd("callComponentMethod", { id: obj.id, component, method, parameters });
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}

/**
 * EngineTransport over a WebView CDP eval channel (v0.3.0 story C3) — drives a
 * WebGL engine (Unity WebGL / PlayCanvas / Cocos) running inside a WKWebView.
 *
 * A <canvas> has no child DOM, so the engine must expose a JS bridge:
 * `window.__podiumEngine(commandJsonString) -> responseObject`. We invoke it via
 * the existing webview eval path (CDP Runtime.evaluate) and parse the JSON
 * result, so the SAME EngineClient works over both native AltTester (WebSocket)
 * and WebGL-in-WebView (CDP) — folding WebGL into the engine ladder.
 *
 * `evalJs` runs a JS expression in the page and resolves with its stringified
 * result. Eval or parse failure becomes a structured error response (fail
 * closed) rather than a thrown transport error.
 */
export function createWebviewEngineTransport(
  evalJs: (expression: string) => Promise<string>
): EngineTransport {
  return {
    async send(command) {
      const cmdJson = JSON.stringify(command);
      const expr = `JSON.stringify((window.__podiumEngine||function(){throw new Error("no __podiumEngine bridge on this WebGL page")})(${JSON.stringify(
        cmdJson
      )}))`;
      let raw: string;
      try {
        raw = await evalJs(expr);
      } catch (e) {
        return { error: { type: "EvalError", message: e instanceof Error ? e.message : String(e) } };
      }
      try {
        return JSON.parse(raw) as EngineResponse;
      } catch {
        return {
          error: { type: "ParseError", message: `engine bridge returned non-JSON: ${String(raw).slice(0, 120)}` },
        };
      }
    },
    async close() {
      /* CDP eval is stateless — nothing to close. */
    },
  };
}

/**
 * WebSocket EngineTransport for a live AltTester server (v0.3.0 story C2).
 *
 * Uses the Node-native global WebSocket (Node 22+), mirroring lib/metro.ts. The
 * request/response is serial (AltTester processes one command at a time). Connect
 * rejects on error/timeout so the tool layer fails closed when no instrumented
 * build is reachable.
 *
 * The exact AltTester v2 WS framing/path is validated against a live instrumented
 * build (hardware-gated — prd.json story C4). The tool logic that consumes this
 * transport is unit-tested with an injected mock (tools/engine.test.ts), so the
 * verifiable surface does not depend on a live server.
 */
import type { EngineTransport, EngineResponse } from "./engine.js";

export interface EngineTransportOptions {
  connectTimeoutMs?: number;
  /** AltTester WS path; default mirrors AltTester v2. */
  path?: string;
}

export async function createEngineTransport(
  host: string,
  port: number,
  opts: EngineTransportOptions = {}
): Promise<EngineTransport> {
  const path = opts.path ?? "/altws/";
  const timeoutMs = opts.connectTimeoutMs ?? 5000;
  const ws = new WebSocket(`ws://${host}:${port}${path}`);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`engine connect timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    ws.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
    ws.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("engine connect failed (no AltTester server reachable)"));
      },
      { once: true }
    );
  });

  return {
    send(command) {
      return new Promise<EngineResponse>((resolve, reject) => {
        const onMessage = (event: MessageEvent) => {
          ws.removeEventListener("message", onMessage);
          try {
            const text = typeof event.data === "string" ? event.data : String(event.data);
            resolve(JSON.parse(text) as EngineResponse);
          } catch (e) {
            reject(new Error(`engine response parse failed: ${e instanceof Error ? e.message : String(e)}`));
          }
        };
        ws.addEventListener("message", onMessage);
        ws.send(JSON.stringify(command));
      });
    },
    async close() {
      ws.close();
    },
  };
}

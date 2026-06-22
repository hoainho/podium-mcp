import { describe, it, expect, vi, beforeEach } from "vitest";
import * as exec from "../lib/exec.js";
import * as nativeLib from "../lib/native.js";
import * as gestureLib from "../lib/gesture.js";
import * as maestroLib from "../lib/maestro.js";
import * as simctlLib from "../lib/simctl.js";
import type { NativeBackend } from "../lib/native.js";

// ─── Minimal typed fake server (mirrors device.test.ts) ──────────────────────
type HandlerFn = (args: Record<string, unknown>) => Promise<{
  isError?: true;
  content: Array<{ type: string; text: string }>;
}>;

interface FakeServer {
  _handlers: Map<string, HandlerFn>;
  tool(name: string, description: string, schema: Record<string, unknown>, handler: HandlerFn): void;
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

/** A native backend whose gestures all succeed and that exposes one labelled element. */
function makeFakeBackend(overrides: Partial<NativeBackend> = {}): NativeBackend {
  const ok = { code: 0, stdout: "", stderr: "" };
  const base = {
    name: "mobilecli" as const,
    tap: vi.fn(async () => ok),
    swipe: vi.fn(async () => ok),
    inputText: vi.fn(async () => ok),
    canPressKey: (k: string) => ["home", "lock", "power", "volume up", "volume down"].includes(k),
    pressKey: vi.fn(async () => ok),
    describeAll: vi.fn(async () => [
      { label: "Log In", frame: { x: 10, y: 20, width: 100, height: 40 } },
    ]),
    screenPoints: vi.fn(async () => ({ w: 402, h: 874 })),
    setOrientation: vi.fn(async () => null),
  };
  return { ...base, ...overrides } as unknown as NativeBackend;
}

async function buildServer() {
  const { registerStepsTools } = await import("./steps.js");
  const fake = makeFakeServer();
  registerStepsTools(fake as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
  return fake;
}

async function callRunSteps(args: Record<string, unknown>) {
  const fake = await buildServer();
  const handler = fake._handlers.get("run_steps");
  expect(handler).toBeDefined();
  const res = await handler!(args);
  return JSON.parse(res.content[0].text) as {
    ok: boolean;
    backend: string;
    total: number;
    ran: number;
    failedAtIndex?: number;
    results: Array<{ i: number; action: string; ok: boolean; backend?: string; [k: string]: unknown }>;
  };
}

describe("run_steps", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("runs a batch end-to-end via the native backend and reports each step", async () => {
    vi.spyOn(nativeLib, "getBackend").mockResolvedValue(makeFakeBackend());
    vi.spyOn(gestureLib, "nativeTap").mockResolvedValue({ ok: true, backend: "mobilecli", detail: "tapped" });
    vi.spyOn(simctlLib, "screenshot").mockResolvedValue({ ok: true, code: 0, stdout: "", stderr: "" });

    const payload = await callRunSteps({
      udid: "UDID",
      bundleId: "com.example.app",
      steps: [
        { action: "tap", x: 200, y: 400 },
        { action: "type", text: "hello" },
        { action: "tapText", text: "Log In" },
        { action: "swipe", direction: "up" },
        { action: "waitFor", text: "Log In", timeoutMs: 1000 },
        { action: "screenshot" },
      ],
    });

    expect(payload.ok).toBe(true);
    expect(payload.total).toBe(6);
    expect(payload.ran).toBe(6);
    expect(payload.results.every((r) => r.ok)).toBe(true);
    // tapText resolved natively → center of (10,20,100,40) = (60,40)
    const tapText = payload.results.find((r) => r.action === "tapText");
    expect(tapText?.backend).toBe("mobilecli");
    expect(tapText?.tappedAt).toEqual({ x: 60, y: 40 });
  });

  it("stops at the first failed step by default and records failedAtIndex", async () => {
    vi.spyOn(nativeLib, "getBackend").mockResolvedValue(makeFakeBackend());
    vi.spyOn(gestureLib, "nativeTap").mockResolvedValue({ ok: false, backend: "maestro", detail: "no backend" });

    const payload = await callRunSteps({
      udid: "UDID",
      steps: [
        { action: "tap", x: 1, y: 2 },
        { action: "type", text: "should-not-run" },
      ],
    });

    expect(payload.ok).toBe(false);
    expect(payload.failedAtIndex).toBe(0);
    expect(payload.ran).toBe(1); // second step never executed
  });

  it("runs all steps when stopOnError is false", async () => {
    vi.spyOn(nativeLib, "getBackend").mockResolvedValue(makeFakeBackend());
    vi.spyOn(gestureLib, "nativeTap").mockResolvedValue({ ok: false, backend: "maestro", detail: "x" });

    const payload = await callRunSteps({
      udid: "UDID",
      stopOnError: false,
      steps: [
        { action: "tap", x: 1, y: 2 },
        { action: "waitMs", ms: 0 },
      ],
    });

    expect(payload.ok).toBe(false);
    expect(payload.ran).toBe(2);
    expect(payload.results[1].action).toBe("waitMs");
    expect(payload.results[1].ok).toBe(true);
  });

  it("tapText falls back to Maestro when no native element matches", async () => {
    // Backend present but its element list never matches → Maestro fallback path.
    vi.spyOn(nativeLib, "getBackend").mockResolvedValue(
      makeFakeBackend({ describeAll: vi.fn(async () => []) })
    );
    // No bundleId is passed, so the shared executor auto-detects the foreground
    // app via resolveForegroundApp → exec.run(launchctl). Mock that here
    // (spying resolveForegroundApp directly can't intercept the same-module call).
    vi.spyOn(exec, "run").mockResolvedValue({
      code: 0,
      stdout: "- 0 UIKitApplication:com.example.app[0x1]",
      stderr: "",
    });
    const flowSpy = vi
      .spyOn(maestroLib, "runMaestroFlow")
      .mockResolvedValue({ passed: true, retries: 0, steps: [], rawOutput: "", durationMs: 1 });

    const payload = await callRunSteps({
      udid: "UDID",
      steps: [{ action: "tapText", text: "Nope" }],
    });

    expect(payload.ok).toBe(true);
    expect(payload.results[0].backend).toBe("maestro");
    expect(flowSpy).toHaveBeenCalledOnce();
  });

  it("waitFor fails fast when the text never appears", async () => {
    vi.spyOn(nativeLib, "getBackend").mockResolvedValue(
      makeFakeBackend({ describeAll: vi.fn(async () => [{ label: "Other" }]) })
    );

    const payload = await callRunSteps({
      udid: "UDID",
      steps: [{ action: "waitFor", text: "Missing", timeoutMs: 0 }],
    });

    expect(payload.ok).toBe(false);
    expect(payload.results[0].action).toBe("waitFor");
    expect(payload.results[0].ok).toBe(false);
  });
});

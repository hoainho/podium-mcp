import { describe, it, expect, vi, beforeEach } from "vitest";
import * as exec from "../lib/exec.js";
import * as gestureLib from "../lib/gesture.js";
import * as nativeLib from "../lib/native.js";

// tap_with_fallback's oracle reads screenshot file sizes via stat(); mock the fs
// layer so we can drive the "screen changed?" decision deterministically.
vi.mock("node:fs/promises", async (orig) => {
  const actual = (await (orig as () => Promise<Record<string, unknown>>)()) as Record<string, unknown>;
  return { ...actual, stat: vi.fn(), unlink: vi.fn(async () => undefined) };
});
import { stat } from "node:fs/promises";

const OK = { code: 0, stdout: "", stderr: "" };

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
  const { registerScreenTools } = await import("./screen.js");
  const fake = makeFakeServer();
  registerScreenTools(fake as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);
  return fake;
}

describe("platform-scope transparency (V2-1)", () => {
  it("press_key description no longer makes a bare Android-only claim and notes iOS", async () => {
    const descriptions = new Map<string, string>();
    const fake = {
      tool(name: string, description: string, _s: unknown, _h: HandlerFn) {
        descriptions.set(name, description);
      },
    };
    const { registerScreenTools } = await import("./screen.js");
    registerScreenTools(fake as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer);

    const pressKey = descriptions.get("press_key")!;
    expect(pressKey).not.toMatch(/back\/power\/tab are Android-only\./);
    expect(pressKey).toMatch(/iOS/);

    const inspect = descriptions.get("inspect_screen")!;
    expect(inspect).not.toMatch(/iOS simulator or Android device/);
  });
});

describe("tap_with_fallback — byte-size fallback oracle (no native backend)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // No native backend → exercises the screenshot byte-size fallback path.
    vi.spyOn(nativeLib, "getBackend").mockResolvedValue(null);
    // Screenshots: exec.run always succeeds (files are not actually written).
    vi.spyOn(exec, "run").mockResolvedValue(OK);
  });

  it("reports ok:false and exhausts maxRetries when the screen never changes", async () => {
    // before == after on every attempt → no detected change.
    vi.mocked(stat).mockResolvedValue({ size: 1000 } as unknown as Awaited<ReturnType<typeof stat>>);
    const tapSpy = vi
      .spyOn(gestureLib, "nativeTap")
      .mockResolvedValue({ ok: true, backend: "idb", detail: "" });

    const fake = await buildServer();
    const handler = fake.handlers.get("tap_with_fallback")!;
    // offsetStep:0 is the schema default; passed explicitly here because the
    // fake server bypasses zod default application.
    const res = await handler({ udid: "U", x: 100, y: 200, maxRetries: 2, offsetStep: 0 });
    const payload = JSON.parse(res.content[0].text) as {
      ok: boolean;
      attemptsUsed: number;
      tappedAt: { x: number; y: number };
    };

    expect(payload.ok).toBe(false);
    expect(tapSpy).toHaveBeenCalledTimes(2); // bounded by maxRetries
    // offsetStep 0 → every attempt taps the exact y (no blind walk-up).
    for (const call of tapSpy.mock.calls) {
      expect(call[2]).toBe(200);
    }
  }, 15_000);

  it("reports ok:true on the first attempt when the screen changes", async () => {
    // before=1000, after=5000 → delta well over the 2% threshold.
    vi.mocked(stat)
      .mockResolvedValueOnce({ size: 1000 } as unknown as Awaited<ReturnType<typeof stat>>)
      .mockResolvedValueOnce({ size: 5000 } as unknown as Awaited<ReturnType<typeof stat>>);
    const tapSpy = vi
      .spyOn(gestureLib, "nativeTap")
      .mockResolvedValue({ ok: true, backend: "idb", detail: "" });

    const fake = await buildServer();
    const handler = fake.handlers.get("tap_with_fallback")!;
    const res = await handler({ udid: "U", x: 100, y: 200, maxRetries: 3, offsetStep: 0 });
    const payload = JSON.parse(res.content[0].text) as { ok: boolean };

    expect(payload.ok).toBe(true);
    expect(tapSpy).toHaveBeenCalledTimes(1); // stopped as soon as change detected
  }, 15_000);
});

describe("tap_with_fallback — a11y structural-change oracle (V2-3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(gestureLib, "nativeTap").mockResolvedValue({ ok: true, backend: "mobilecli", detail: "" });
  });

  function backendWithDescribe(seq: Array<Array<{ label?: string }>>) {
    let i = 0;
    return {
      name: "mobilecli",
      tap: vi.fn(async () => OK),
      swipe: vi.fn(),
      inputText: vi.fn(),
      canPressKey: () => false,
      pressKey: vi.fn(),
      describeAll: vi.fn(async () => seq[Math.min(i++, seq.length - 1)]),
      screenPoints: vi.fn(),
      setOrientation: vi.fn(),
    } as unknown as nativeLib.NativeBackend;
  }

  it("no false-positive: stable a11y tree → ok:false even though pixels would churn", async () => {
    // describeAll returns the SAME element set on every call → no structural change.
    vi.spyOn(nativeLib, "getBackend").mockResolvedValue(backendWithDescribe([[{ label: "A" }]]));

    const fake = await buildServer();
    const res = await fake.handlers.get("tap_with_fallback")!({ udid: "U", x: 10, y: 20, maxRetries: 2, offsetStep: 0 });
    const payload = JSON.parse(res.content[0].text) as { ok: boolean; oracle: string };
    expect(payload.ok).toBe(false);
    expect(payload.oracle).toBe("a11y-change");
  }, 15_000);

  it("ok:true when the a11y element set changes after the tap", async () => {
    // before=[A], after=[B] → structural change detected on attempt 1.
    vi.spyOn(nativeLib, "getBackend").mockResolvedValue(
      backendWithDescribe([[{ label: "A" }], [{ label: "B" }]])
    );

    const fake = await buildServer();
    const res = await fake.handlers.get("tap_with_fallback")!({ udid: "U", x: 10, y: 20, maxRetries: 3, offsetStep: 0 });
    const payload = JSON.parse(res.content[0].text) as { ok: boolean; oracle: string };
    expect(payload.ok).toBe(true);
    expect(payload.oracle).toBe("a11y-change");
  }, 15_000);

  it("oracle:'unverified' when the a11y tree is unreadable (WebView content)", async () => {
    // describeAll returns null → can't verify structurally → tap delivered, unverified.
    vi.spyOn(nativeLib, "getBackend").mockResolvedValue(backendWithDescribe([null as unknown as Array<{ label?: string }>]));

    const fake = await buildServer();
    const res = await fake.handlers.get("tap_with_fallback")!({ udid: "U", x: 10, y: 20, maxRetries: 2, offsetStep: 0 });
    const payload = JSON.parse(res.content[0].text) as { ok: boolean; oracle: string };
    expect(payload.ok).toBe(true);
    expect(payload.oracle).toBe("unverified");
  }, 15_000);
});

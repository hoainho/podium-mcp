import { z } from "zod";
import os from "node:os";
import path from "node:path";
import { stat } from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getBackend,
  type NativeBackend,
} from "../lib/native.js";
import {
  nativeTap,
  nativeKey,
  nativeInputText,
  nativeSwipe,
  nativeTapText,
} from "../lib/gesture.js";
import { pollVisible } from "../lib/oracle.js";
import { screenshot as simctlScreenshot } from "../lib/simctl.js";
import { okResult } from "../lib/result.js";

/**
 * run_steps — batch UI macro.
 *
 * Why this exists: every other interaction tool is one MCP round-trip per
 * gesture. Even when each gesture is native (sub-second), the round-trip plus
 * the agent's between-call reasoning dominates wall-clock. run_steps executes
 * an ordered list of actions IN ONE CALL via the native backend (idb/mobilecli,
 * with a Maestro fallback per step), so a whole login/navigation/form-fill is a
 * single invocation. `waitFor` polls the live element tree so the next action
 * fires the instant the UI is ready — no blind sleeps.
 */

const KEY_VALUES = [
  "enter",
  "home",
  "lock",
  "backspace",
  "volume up",
  "volume down",
  "back",
  "power",
  "tab",
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Step schema (discriminated union on `action`) ────────────────────────────

// Blessed as the canonical action vocabulary (IR) — also consumed by the Maestro exporter.
export const stepSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("tap"),
      x: z.number().describe("X in logical points"),
      y: z.number().describe("Y in logical points"),
    })
    .describe("Tap an absolute logical-point coordinate (works on WebView content)."),
  z
    .object({
      action: z.literal("tapText"),
      text: z.string().optional().describe("Element text/regex. Matches the FULL label/value case-insensitively (anchored ^…$); an invalid regex falls back to a substring match."),
      id: z.string().optional().describe("Accessibility id"),
      index: z.number().int().min(0).optional().describe("Index when multiple match"),
    })
    .describe("Tap a native accessibility element by text or id (not WebView-rendered text)."),
  z
    .object({
      action: z.literal("type"),
      text: z.string().describe("Text to type into the focused element"),
      submit: z.boolean().optional().describe("Press Enter after typing"),
    })
    .describe("Type into the currently-focused field (real keystrokes → React onChange fires)."),
  z
    .object({
      action: z.literal("key"),
      key: z.enum(KEY_VALUES).describe("Hardware/system key"),
    })
    .describe("Press a hardware/system key."),
  z
    .object({
      action: z.literal("swipe"),
      direction: z.enum(["up", "down", "left", "right"]).optional(),
      startX: z.number().optional(),
      startY: z.number().optional(),
      endX: z.number().optional(),
      endY: z.number().optional(),
    })
    .describe("Swipe by direction (default) or between two logical-point coordinates."),
  z
    .object({
      action: z.literal("waitFor"),
      text: z.string().describe("Wait until an element with this text/regex is visible"),
      timeoutMs: z.number().int().min(0).max(120_000).optional().describe("Default 10 000"),
    })
    .describe("Poll the element tree until text appears (act-when-ready, not a blind sleep)."),
  z
    .object({
      action: z.literal("waitMs"),
      ms: z.number().int().min(0).max(30_000).describe("Fixed delay in ms"),
    })
    .describe("Fixed delay (use sparingly; prefer waitFor)."),
  z
    .object({
      action: z.literal("screenshot"),
      saveTo: z
        .string()
        .regex(/\.(png|jpg)$/i, "saveTo must end with .png or .jpg")
        .optional(),
    })
    .describe("Capture a screenshot mid-flow (for evidence)."),
  z
    .object({
      action: z.literal("assertVisible"),
      text: z.string().describe("Assert an element with this text/regex is visible"),
      timeoutMs: z.number().int().min(0).max(120_000).optional().describe("Default 3 000"),
    })
    .describe("Assert text is visible (short poll); fails the step if absent."),
]);

export type Step = z.infer<typeof stepSchema>;

interface StepResult {
  i: number;
  action: Step["action"];
  ok: boolean;
  [k: string]: unknown;
}

// ─── Step executor ──────────────────────────────────────────────────────────
// (visibility polling lives in lib/oracle.ts — pollVisible, shared with assert_*)

async function execStep(
  udid: string,
  bundleId: string | undefined,
  be: NativeBackend | null,
  step: Step,
  i: number
): Promise<StepResult> {
  switch (step.action) {
    case "tap": {
      const r = await nativeTap(udid, step.x, step.y, { bundleId });
      return { i, action: "tap", ok: r.ok, backend: r.backend, at: { x: step.x, y: step.y }, detail: r.detail };
    }

    case "tapText": {
      const g = await nativeTapText(udid, { text: step.text, id: step.id, index: step.index }, { bundleId });
      const res: StepResult = { i, action: "tapText", ok: g.ok, backend: g.backend };
      if (g.tappedAt) res.tappedAt = g.tappedAt;
      if (g.selector) res.selector = g.selector;
      if (!g.ok && g.detail) res.error = g.detail;
      return res;
    }

    case "type": {
      const g = await nativeInputText(udid, step.text, { submit: step.submit, bundleId });
      const res: StepResult = { i, action: "type", ok: g.ok, backend: g.backend };
      if (g.submit !== undefined) res.submit = g.submit;
      if (g.ok && g.detail) res.detail = g.detail;
      if (!g.ok && g.detail) res.error = g.detail;
      return res;
    }

    case "key": {
      const g = await nativeKey(udid, step.key, { bundleId });
      const res: StepResult = { i, action: "key", ok: g.ok, backend: g.backend, key: step.key };
      if (!g.ok && g.detail) res.error = g.detail;
      return res;
    }

    case "swipe": {
      const points =
        step.startX !== undefined &&
        step.startY !== undefined &&
        step.endX !== undefined &&
        step.endY !== undefined
          ? { x1: step.startX, y1: step.startY, x2: step.endX, y2: step.endY }
          : undefined;
      const g = await nativeSwipe(udid, { direction: step.direction, points }, { bundleId });
      const res: StepResult = { i, action: "swipe", ok: g.ok, backend: g.backend };
      if (g.points) res.points = g.points;
      if (!g.ok && g.detail) res.error = g.detail;
      return res;
    }

    case "waitFor": {
      const timeout = step.timeoutMs ?? 10_000;
      const found = await pollVisible(udid, be, step.text, timeout, bundleId);
      return found
        ? { i, action: "waitFor", ok: true, text: step.text }
        : { i, action: "waitFor", ok: false, text: step.text, error: `not visible within ${timeout}ms` };
    }

    case "assertVisible": {
      const timeout = step.timeoutMs ?? 3_000;
      const found = await pollVisible(udid, be, step.text, timeout, bundleId);
      return found
        ? { i, action: "assertVisible", ok: true, text: step.text }
        : { i, action: "assertVisible", ok: false, text: step.text, error: `not visible within ${timeout}ms` };
    }

    case "waitMs": {
      await sleep(step.ms);
      return { i, action: "waitMs", ok: true, ms: step.ms };
    }

    case "screenshot": {
      const out = step.saveTo ?? path.join(os.tmpdir(), `podium-step-${i}-${Date.now()}.png`);
      const r = await simctlScreenshot(udid, out);
      if (!r.ok) return { i, action: "screenshot", ok: false, error: r.stderr || r.stdout };
      let byteSize: number | null = null;
      try {
        byteSize = (await stat(out)).size;
      } catch {
        // non-fatal
      }
      return { i, action: "screenshot", ok: true, path: out, byteSize };
    }
  }
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerStepsTools(server: McpServer): void {
  server.tool(
    "run_steps",
    "Execute an ordered batch of UI actions in ONE call via the native backend " +
      "(idb/mobilecli, sub-second; Maestro fallback per step). Eliminates per-gesture MCP " +
      "round-trips for fast continuous flows (login, navigation, form fill). " +
      "Step actions: tap {x,y} · tapText {text|id} · type {text,submit} · key · swipe · " +
      "waitFor {text,timeoutMs} · assertVisible {text} · waitMs · screenshot. " +
      "Prefer `waitFor` over `waitMs` to act the instant the UI is ready instead of sleeping. " +
      "WebView note: web-rendered text is invisible to tapText — use tap {x,y} for it; `type` " +
      "uses real keystrokes so React onChange fires. Stops at the first failed step unless " +
      "stopOnError:false. bundleId is only needed for the Maestro fallback (auto-detected otherwise). " +
      "When to use: pick run_steps for >2 known sequential gestures (login, navigation, form fill); " +
      "use run_flow for Maestro assertions/conditionals/loops/retries; use the individual gesture " +
      "tools (tap_on, swipe, …) for a single exploratory action.",
    {
      udid: z.string().describe("Simulator / device UDID (from device_list)"),
      bundleId: z
        .string()
        .optional()
        .describe("App bundle id for Maestro fallbacks (auto-detected from the foreground app if omitted)."),
      steps: z.array(stepSchema).min(1).max(200).describe("Ordered list of actions to perform."),
      stopOnError: z
        .boolean()
        .optional()
        .describe("Stop at the first failed step (default true). false = run all and report each."),
      stepDelayMs: z
        .number()
        .int()
        .min(0)
        .max(10_000)
        .optional()
        .describe("Optional fixed delay inserted after every step (default 0)."),
    },
    async ({ udid, bundleId, steps, stopOnError, stepDelayMs }) => {
      const be = await getBackend();
      const results: StepResult[] = [];
      let allOk = true;
      let failedAtIndex: number | null = null;

      for (let i = 0; i < steps.length; i++) {
        let res: StepResult;
        try {
          res = await execStep(udid, bundleId, be, steps[i], i);
        } catch (err) {
          res = { i, action: steps[i].action, ok: false, error: String(err) };
        }
        results.push(res);
        if (!res.ok) {
          allOk = false;
          if (failedAtIndex === null) failedAtIndex = i;
          if (stopOnError !== false) break;
        }
        if (stepDelayMs && stepDelayMs > 0) await sleep(stepDelayMs);
      }

      const payload = {
        ok: allOk,
        backend: be?.name ?? "maestro",
        total: steps.length,
        ran: results.length,
        ...(failedAtIndex !== null ? { failedAtIndex } : {}),
        results,
      };
      if (allOk) return okResult(payload);
      // A failed batch must NOT report status:"ok" — a weak model would read the
      // envelope status, not scan per-step results, and assume success.
      const failed = failedAtIndex !== null ? results[failedAtIndex] : undefined;
      return okResult(payload, {
        status: "failed",
        next: [
          `Step ${failedAtIndex} (${failed?.action ?? "?"}) failed${failed?.error ? `: ${failed.error}` : ""}.`,
          "Call inspect_screen to confirm the current UI, fix that step's target, then re-run the remaining steps from that index.",
        ],
      });
    }
  );
}

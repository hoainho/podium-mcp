import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getHierarchy, runMaestroFlow } from "../lib/maestro.js";
import { run } from "../lib/exec.js";
import { getBackend, findElements, elementCenter } from "../lib/native.js";
import { nativeTap } from "../lib/gesture.js";

/** Parse "35%" against a span, or a plain number string verbatim. Null on junk. */
function resolveCoord(raw: string, span: number): number | null {
  const pct = /^(\d+(?:\.\d+)?)%$/.exec(raw.trim());
  if (pct) return (parseFloat(pct[1]) / 100) * span;
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : null;
}
import { stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import { errorResult, okResult } from "../lib/result.js";

/** A flattened, model-friendly view of one UI node. */
interface CompactNode {
  text: string;
  id?: string;
  bounds?: string;
  enabled?: boolean;
}

/** Non-empty string guard. */
function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Flatten a Maestro hierarchy tree into a flat list of nodes that carry
 * meaningful content (text / accessibility label / resource-id). Drops the
 * deeply-nested empty container chrome that bloats the raw tree to tens of KB.
 */
function flattenHierarchy(root: unknown): CompactNode[] {
  const out: CompactNode[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { attributes?: Record<string, unknown>; children?: unknown[] };
    const a = n.attributes ?? {};
    const text =
      [a["text"], a["accessibilityText"], a["title"], a["value"], a["hintText"]].find(nonEmpty) ?? "";
    const id = a["resource-id"];
    if (nonEmpty(text) || nonEmpty(id)) {
      out.push({
        text: String(text),
        ...(nonEmpty(id) ? { id: String(id) } : {}),
        ...(nonEmpty(a["bounds"]) ? { bounds: String(a["bounds"]) } : {}),
        ...(a["enabled"] !== undefined ? { enabled: String(a["enabled"]) === "true" } : {}),
      });
    }
    if (Array.isArray(n.children)) {
      for (const c of n.children) visit(c);
    }
  };
  visit(root);
  return out;
}


// ─── Key enum for press_key ───────────────────────────────────────────────────
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

type Key = (typeof KEY_VALUES)[number];

/** Capitalize first letter for the YAML ("enter" → "Enter"); Maestro matches pressKey case-insensitively. */
function fmtKey(k: Key): string {
  return k.charAt(0).toUpperCase() + k.slice(1);
}

export function registerScreenTools(server: McpServer): void {
  // ─── inspect_screen ──────────────────────────────────────────────────────────
  server.tool(
    "inspect_screen",
    "Returns the current view hierarchy for a booted iOS simulator or Android device. " +
      "Uses idb's flat accessibility tree when idb is installed (fast), else maestro hierarchy. " +
      "Defaults to compact:true — a flattened list of only the nodes that carry text / " +
      "accessibility labels / resource-ids (dramatically smaller than the raw tree). Pass " +
      "compact:false for the full nested hierarchy. " +
      "LIMITATION: WebView (WKWebView/WebView) content is opaque — the hierarchy shows a single " +
      "WebView node with no children. Web-rendered buttons, inputs, and labels are invisible to " +
      "this tool. For WebView apps, identify elements visually via screenshot then calculate " +
      "logical-point coordinates (screenshot pixels ÷ device scale factor, typically ÷3 on 3× Retina).",
    {
      udid: z.string().describe("Simulator / device UDID (from device_list)"),
      compact: z
        .boolean()
        .optional()
        .describe("Return a flattened list of meaningful nodes only (default true). false = full nested tree."),
    },
    async ({ udid, compact }) => {
      const useCompact = compact !== false; // default true

      // Native fast-path: flat element list, already compact-friendly
      const be = await getBackend();
      if (be) {
        const elements = await be.describeAll(udid);
        if (elements) {
          const els = useCompact
            ? elements.filter((e) => e.label || e.value || e.identifier)
            : elements;
          return okResult({ backend: be.name, count: els.length, elements: els });
        }
        // backend failed — fall through to maestro
      }

      const result = await getHierarchy(udid);
      if (!result.ok) {
        return errorResult(result.text);
      }
      if (useCompact) {
        const flat = flattenHierarchy(result.json);
        return okResult({ backend: "maestro", compact: true, count: flat.length, elements: flat });
      }
      return okResult({ backend: "maestro", compact: false, hierarchy: result.json });
    }
  );

  // ─── tap_on ──────────────────────────────────────────────────────────────────
  server.tool(
    "tap_on",
    "Tap, double-tap, or long-press an element on screen via an ephemeral Maestro flow. " +
      "Target by text (regex), accessibility id, or absolute x/y coordinates. " +
      "bundleId is REQUIRED — Maestro needs it for the appId flow header." +
      " WebView caution: text/id selectors only resolve native accessibility nodes. Web-rendered elements inside WKWebView are invisible — tap_on will report COMPLETED but nothing is tapped. Use x+y coordinates instead for WebView content.",
    {
      udid: z.string().describe("Simulator / device UDID"),
      bundleId: z
        .string()
        .describe("App bundle identifier (e.g. com.example.MyApp). Required by Maestro."),
      text: z.string().optional().describe("Element text or regex to tap on"),
      id: z.string().optional().describe("Accessibility ID of the element"),
      x: z.number().optional().describe("X coordinate (absolute px or percent string not yet supported via number)"),
      y: z.number().optional().describe("Y coordinate — required when x is provided"),
      double: z.boolean().optional().describe("Use doubleTapOn instead of tapOn"),
      long: z.boolean().optional().describe("Use longPressOn instead of tapOn"),
      longDurationMs: z
        .number()
        .int()
        .min(1)
        .max(10000)
        .optional()
        .describe("Hold duration for long press in ms (max 10 000)"),
      index: z.number().int().min(0).optional().describe("Zero-based index when multiple elements match"),
      timeoutMs: z.number().int().optional().describe("Flow timeout in ms (default 30 000)"),
      noLaunch: z.boolean().optional().describe("Skip the implicit launchApp attach step (default false). Set true when an open modal or navigation state must not be disturbed."),
    },
    async ({ udid, bundleId, text, id, x, y, double: isDouble, long: isLong, longDurationMs, index, timeoutMs, noLaunch }) => {
      // Validate: x/y pairing first (an x-only call is a malformed point, not a missing selector)
      if ((x !== undefined) !== (y !== undefined)) {
        return errorResult("tap_on: x and y must be provided together.");
      }
      const hasPoint = x !== undefined && y !== undefined;
      if (!text && !id && !hasPoint) {
        return errorResult("tap_on requires at least one of: text, id, or x+y coordinates.");
      }

      // Choose command
      let cmd: string;
      if (isLong) {
        cmd = "longPressOn";
      } else if (isDouble) {
        cmd = "doubleTapOn";
      } else {
        cmd = "tapOn";
      }

      // Build selector
      let selector: string;
      if (hasPoint) {
        selector = `{ point: "${x},${y}"${index !== undefined ? `, index: ${index}` : ""} }`;
      } else if (text && id) {
        selector = `{ text: ${JSON.stringify(text)}, id: ${JSON.stringify(id)}${index !== undefined ? `, index: ${index}` : ""} }`;
      } else if (text) {
        selector =
          index !== undefined
            ? `{ text: ${JSON.stringify(text)}, index: ${index} }`
            : JSON.stringify(text);
      } else {
        // id only
        selector =
          index !== undefined
            ? `{ id: ${JSON.stringify(id)}, index: ${index} }`
            : `{ id: ${JSON.stringify(id!)} }`;
      }

      // Native fast-path: plain taps only (double/long stay on Maestro for fidelity).
      // Any miss or failure falls through to the Maestro flow below.
      const be = !isLong && !isDouble ? await getBackend() : null;
      if (be) {
        let point: { x: number; y: number } | null = hasPoint ? { x: x!, y: y! } : null;
        if (!point) {
          const elements = await be.describeAll(udid);
          if (elements) {
            const matches = findElements(elements, { text, id });
            const el = matches[index ?? 0];
            if (el) point = elementCenter(el);
          }
        }
        if (point) {
          const r = await be.tap(udid, point.x, point.y);
          if (r.code === 0) {
            return okResult({ ok: true, cmd, selector, backend: be.name, tappedAt: point });
          }
        }
      }

      // longPressDuration option
      const durationLine =
        isLong && longDurationMs !== undefined
          ? `  longPressTimeout: ${longDurationMs}\n`
          : "";

      const yaml = [
        `appId: ${bundleId}`,
        `---`,
        ...(noLaunch ? [] : [`- launchApp:`, `    stopApp: false`]),
        `- ${cmd}: ${selector}`,
        durationLine ? durationLine.trimEnd() : "",
      ]
        .filter((l) => l !== "")
        .join("\n");

      try {
        const result = await runMaestroFlow({ udid, yaml, timeoutMs: timeoutMs ?? 30_000 });
        if (!result.passed) {
          return errorResult(
            `tap_on flow did not pass (retries: ${result.retries}):\n${result.rawOutput}`
          );
        }
        return okResult({ ok: true, cmd, selector, retries: result.retries, steps: result.steps });
      } catch (err) {
        return errorResult(`tap_on failed: ${String(err)}`);
      }
    }
  );

  // ─── input_text ──────────────────────────────────────────────────────────────
  server.tool(
    "input_text",
    "Types text into the currently-focused element via an ephemeral Maestro flow. " +
      "Set submit:true to press Enter after typing. Note: Android does not support Unicode via inputText. " +
      "WebView caveat: inputText injects at the native buffer level — React onChange/onChangeText never fires. For WebView forms use mobile-mcp mobile_type_keys (real keystroke simulation) instead.",
    {
      udid: z.string().describe("Simulator / device UDID"),
      bundleId: z.string().describe("App bundle identifier"),
      text: z.string().describe("Text to type"),
      submit: z.boolean().optional().describe("Press Enter after typing (default false)"),
      timeoutMs: z.number().int().optional().describe("Flow timeout in ms"),
      noLaunch: z.boolean().optional().describe("Skip the implicit launchApp attach step (default false). Set true when an open modal or navigation state must not be disturbed."),
    },
    async ({ udid, bundleId, text, submit, timeoutMs, noLaunch }) => {
      // Native fast-path. When submit is requested the backend must also be
      // able to press Enter natively — otherwise the whole op stays on Maestro.
      const be = await getBackend();
      if (be && (!submit || be.canPressKey("enter"))) {
        const r = await be.inputText(udid, text);
        if (r.code === 0) {
          if (submit) {
            const k = await be.pressKey(udid, "enter");
            if (k && k.code === 0) {
              return okResult({ ok: true, text, submit: true, backend: be.name });
            }
            // Text is already typed — falling back to Maestro would re-type it.
            return errorResult(
              `input_text: text typed (backend: ${be.name}) but Enter failed: ${k ? k.stderr || k.stdout : "no mapping"}. ` +
                "Retry submit via press_key."
            );
          } else {
            return okResult({ ok: true, text, submit: false, backend: be.name });
          }
        }
        // native input failed — fall through to Maestro
      }

      const lines = [
        `appId: ${bundleId}`,
        `---`,
        ...(noLaunch ? [] : [`- launchApp:`, `    stopApp: false`]),
        `- inputText: ${JSON.stringify(text)}`,
      ];
      if (submit) {
        lines.push(`- pressKey: "Enter"`);
      }
      const yaml = lines.join("\n");

      try {
        const result = await runMaestroFlow({ udid, yaml, timeoutMs: timeoutMs ?? 30_000 });
        if (!result.passed) {
          return errorResult(
            `input_text flow did not pass (retries: ${result.retries}):\n${result.rawOutput}`
          );
        }
        return okResult({ ok: true, text, submit: submit ?? false, retries: result.retries });
      } catch (err) {
        return errorResult(`input_text failed: ${String(err)}`);
      }
    }
  );

  // ─── swipe ───────────────────────────────────────────────────────────────────
  server.tool(
    "swipe",
    "Swipes in a direction or between two coordinates via an ephemeral Maestro flow. " +
      "direction is always required; startX/startY/endX/endY are optional overrides " +
      "expressed as percentage strings (e.g. '10%,50%') or pixel values.",
    {
      udid: z.string().describe("Simulator / device UDID"),
      bundleId: z.string().describe("App bundle identifier"),
      direction: z
        .enum(["up", "down", "left", "right"])
        .describe("Swipe direction"),
      startX: z.string().optional().describe("Start X (e.g. '10%' or '120')"),
      startY: z.string().optional().describe("Start Y"),
      endX: z.string().optional().describe("End X"),
      endY: z.string().optional().describe("End Y"),
      timeoutMs: z.number().int().optional().describe("Flow timeout in ms"),
      noLaunch: z.boolean().optional().describe("Skip the implicit launchApp attach step (default false). Set true when an open modal or navigation state must not be disturbed."),
    },
    async ({ udid, bundleId, direction, startX, startY, endX, endY, timeoutMs, noLaunch }) => {
      // Native fast-path: resolve coordinates (defaults by direction, or the
      // explicit overrides — supporting both "35%" and pixel-style values)
      // against the logical screen size. Falls through to Maestro on any gap.
      const be = await getBackend();
      if (be) {
        const dims = await be.screenPoints(udid);
        if (dims) {
          let pts: { x1: number; y1: number; x2: number; y2: number } | null = null;
          if (
            startX !== undefined &&
            startY !== undefined &&
            endX !== undefined &&
            endY !== undefined
          ) {
            const x1 = resolveCoord(startX, dims.w);
            const y1 = resolveCoord(startY, dims.h);
            const x2 = resolveCoord(endX, dims.w);
            const y2 = resolveCoord(endY, dims.h);
            if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
              pts = { x1, y1, x2, y2 };
            }
          } else {
            const cx = dims.w / 2;
            const cy = dims.h / 2;
            pts =
              direction === "up"
                ? { x1: cx, y1: dims.h * 0.7, x2: cx, y2: dims.h * 0.3 }
                : direction === "down"
                  ? { x1: cx, y1: dims.h * 0.3, x2: cx, y2: dims.h * 0.7 }
                  : direction === "left"
                    ? { x1: dims.w * 0.8, y1: cy, x2: dims.w * 0.2, y2: cy }
                    : { x1: dims.w * 0.2, y1: cy, x2: dims.w * 0.8, y2: cy };
          }
          if (pts) {
            const r = await be.swipe(udid, pts.x1, pts.y1, pts.x2, pts.y2);
            if (r.code === 0) {
              return okResult({ ok: true, direction, backend: be.name, points: pts });
            }
            // native swipe failed — fall through to Maestro
          }
        }
      }

      let swipeLine: string;
      if (startX !== undefined && startY !== undefined && endX !== undefined && endY !== undefined) {
        swipeLine = `- swipe:\n    start: "${startX},${startY}"\n    end: "${endX},${endY}"`;
      } else {
        swipeLine = `- swipe:\n    direction: ${direction.toUpperCase()}`;
      }

      const yaml = [
        `appId: ${bundleId}`,
        `---`,
        ...(noLaunch ? [] : [`- launchApp:`, `    stopApp: false`]),
        swipeLine,
      ].join("\n");

      try {
        const result = await runMaestroFlow({ udid, yaml, timeoutMs: timeoutMs ?? 30_000 });
        if (!result.passed) {
          return errorResult(
            `swipe flow did not pass (retries: ${result.retries}):\n${result.rawOutput}`
          );
        }
        return okResult({ ok: true, direction, retries: result.retries });
      } catch (err) {
        return errorResult(`swipe failed: ${String(err)}`);
      }
    }
  );

  // ─── press_key ───────────────────────────────────────────────────────────────
  server.tool(
    "press_key",
    "Presses a hardware or system key via an ephemeral Maestro flow. " +
      "back/power/tab are Android-only. " +
      "Valid keys: " + KEY_VALUES.join(", "),
    {
      udid: z.string().describe("Simulator / device UDID"),
      bundleId: z.string().describe("App bundle identifier"),
      key: z.enum(KEY_VALUES).describe("Key to press"),
      timeoutMs: z.number().int().optional().describe("Flow timeout in ms"),
      noLaunch: z.boolean().optional().describe("Skip the implicit launchApp attach step (default false). Set true when an open modal or navigation state must not be disturbed."),
    },
    async ({ udid, bundleId, key, timeoutMs, noLaunch }) => {
      // Native fast-path for keys the backend maps (home/lock/volume/enter/…).
      const be = await getBackend();
      if (be && be.canPressKey(key)) {
        const r = await be.pressKey(udid, key);
        if (r && r.code === 0) {
          return okResult({ ok: true, key, backend: be.name });
        }
        // native press failed — fall through to Maestro
      }

      const yaml = [
        `appId: ${bundleId}`,
        `---`,
        ...(noLaunch ? [] : [`- launchApp:`, `    stopApp: false`]),
        `- pressKey: ${JSON.stringify(fmtKey(key as Key))}`,
      ].join("\n");

      try {
        const result = await runMaestroFlow({ udid, yaml, timeoutMs: timeoutMs ?? 15_000 });
        if (!result.passed) {
          return errorResult(
            `press_key flow did not pass (retries: ${result.retries}):\n${result.rawOutput}`
          );
        }
        return okResult({ ok: true, key, retries: result.retries });
      } catch (err) {
        return errorResult(`press_key failed: ${String(err)}`);
      }
    }
  );

  // ─── orientation_set ─────────────────────────────────────────────────────────
  const ORIENTATION_VALUES = [
    "PORTRAIT",
    "LANDSCAPE_LEFT",
    "LANDSCAPE_RIGHT",
    "UPSIDE_DOWN",
  ] as const;

  server.tool(
    "orientation_set",
    "Sets the screen orientation on an iOS simulator via an ephemeral Maestro flow. " +
      "bundleId is required (Maestro needs it for the appId flow header). " +
      "Valid values: " + ORIENTATION_VALUES.join(", "),
    {
      udid: z.string().describe("Simulator / device UDID"),
      bundleId: z.string().describe("App bundle identifier"),
      value: z
        .enum(ORIENTATION_VALUES)
        .describe("Target orientation: PORTRAIT | LANDSCAPE_LEFT | LANDSCAPE_RIGHT | UPSIDE_DOWN"),
      timeoutMs: z.number().int().optional().describe("Flow timeout in ms"),
      noLaunch: z.boolean().optional().describe("Skip the implicit launchApp attach step (default false). Set true when an open modal or navigation state must not be disturbed."),
    },
    async ({ udid, bundleId, value, timeoutMs, noLaunch }) => {
      // Native fast-path (mobilecli supports portrait/landscape; others fall through).
      const be = await getBackend();
      if (be) {
        const r = await be.setOrientation(udid, value);
        if (r && r.code === 0) {
          return okResult({ ok: true, value, backend: be.name });
        }
        // unsupported value or failure — fall through to Maestro
      }

      const yaml = [
        `appId: ${bundleId}`,
        `---`,
        ...(noLaunch ? [] : [`- launchApp:`, `    stopApp: false`]),
        `- setOrientation: ${value}`,
      ].join("\n");

      try {
        const result = await runMaestroFlow({ udid, yaml, timeoutMs: timeoutMs ?? 15_000 });
        if (!result.passed) {
          return errorResult(
            `orientation_set flow did not pass (retries: ${result.retries}):\n${result.rawOutput}`
          );
        }
        return okResult({ ok: true, value, retries: result.retries });
      } catch (err) {
        return errorResult(`orientation_set failed: ${String(err)}`);
      }
    }
  );

  // ─── tap_with_fallback ───────────────────────────────────────────────────────
  server.tool(
    "tap_with_fallback",
    "Sends a raw coordinate tap via the native backend (idb if installed, else a Maestro " +
      "tapOn-point fallback), then verifies registration by comparing before/after screenshot " +
      "file sizes. If no screen change is detected, retries at y - offsetStep increments up to " +
      "maxRetries times. Useful for WKWebView game overlays where visual position differs from " +
      "the DOM hit-test position. The Maestro fallback needs an app context: pass bundleId, or " +
      "the foreground app is auto-detected.",
    {
      udid: z.string().describe("Simulator / device UDID"),
      x: z.number().describe("X coordinate in logical points"),
      y: z.number().describe("Y coordinate in logical points"),
      bundleId: z
        .string()
        .optional()
        .describe("App bundle id for the Maestro fallback (ignored when idb is present). Auto-detected if omitted."),
      maxRetries: z.number().int().min(1).max(10).default(3).describe("Maximum tap attempts (default 3)"),
      offsetStep: z.number().default(15).describe("Y offset step in pixels per retry (default 15)"),
    },
    async ({ udid, x, y, bundleId, maxRetries, offsetStep }) => {
      let attemptsUsed = 0;
      let offsetApplied = 0;
      let backend = "";

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const currentY = y - attempt * offsetStep;
        offsetApplied = attempt * offsetStep;
        attemptsUsed = attempt + 1;

        const ts = Date.now();
        const beforePath = join(os.tmpdir(), `podium-tap-before-${ts}.png`);
        const afterPath = join(os.tmpdir(), `podium-tap-after-${ts}.png`);

        try {
          // Take before screenshot
          const beforeSnap = await run("xcrun", ["simctl", "io", udid, "screenshot", beforePath], { timeout: 15_000 });
          if (beforeSnap.code !== 0) {
            return errorResult(`tap_with_fallback: screenshot before failed: ${beforeSnap.stderr || beforeSnap.stdout}`);
          }

          // Send the tap via the native backend (idb → maestro fallback)
          const tap = await nativeTap(udid, x, currentY, { bundleId });
          backend = tap.backend;
          if (!tap.ok) {
            return errorResult(`tap_with_fallback: tap failed (backend: ${tap.backend}): ${tap.detail}`);
          }

          // Wait 1.5 seconds for screen change
          await new Promise<void>((resolve) => setTimeout(resolve, 1500));

          // Take after screenshot
          const afterSnap = await run("xcrun", ["simctl", "io", udid, "screenshot", afterPath], { timeout: 15_000 });
          if (afterSnap.code !== 0) {
            return errorResult(`tap_with_fallback: screenshot after failed: ${afterSnap.stderr || afterSnap.stdout}`);
          }

          // Compare sizes: if within ±2% treat as same (no change)
          let beforeSize = 0;
          let afterSize = 0;
          try {
            beforeSize = (await stat(beforePath)).size;
            afterSize = (await stat(afterPath)).size;
          } catch {
            // If we can't stat, assume success
            return okResult({ ok: true, backend, tappedAt: { x, y: currentY }, attemptsUsed, offsetApplied });
          }

          const delta = Math.abs(afterSize - beforeSize);
          const threshold = Math.max(beforeSize * 0.02, 1);
          const tapRegistered = delta > threshold;

          if (tapRegistered) {
            return okResult({ ok: true, backend, tappedAt: { x, y: currentY }, attemptsUsed, offsetApplied });
          }
          // No change detected — try next offset on next iteration
        } finally {
          await unlink(beforePath).catch(() => undefined);
          await unlink(afterPath).catch(() => undefined);
        }
      }

      // All attempts exhausted — the tap fired but no visible screen change was detected
      return okResult({
        ok: false,
        backend,
        tappedAt: { x, y: y - (maxRetries - 1) * offsetStep },
        attemptsUsed,
        offsetApplied: (maxRetries - 1) * offsetStep,
        note: "tap was delivered but no screen change detected (target may be inert or off-screen)",
      });
    }
  );

  // ─── notification_bar_clear ──────────────────────────────────────────────────
  server.tool(
    "notification_bar_clear",
    "Attempts to dismiss the React Native debug notification bar that sometimes appears " +
      "at the bottom of the screen and intercepts taps. Taps the debug icons area at (50, 850) " +
      "via the native backend (idb, else Maestro) and takes a before/after screenshot to report " +
      "whether the bar was cleared.",
    {
      udid: z.string().describe("Simulator / device UDID"),
      bundleId: z
        .string()
        .optional()
        .describe("App bundle id for the Maestro fallback (ignored when idb is present). Auto-detected if omitted."),
    },
    async ({ udid, bundleId }) => {
      const ts = Date.now();
      const beforePath = join(os.tmpdir(), `podium-notif-before-${ts}.png`);
      const afterPath = join(os.tmpdir(), `podium-notif-after-${ts}.png`);

      try {
        // Take before screenshot
        const beforeSnap = await run("xcrun", ["simctl", "io", udid, "screenshot", beforePath], { timeout: 15_000 });
        if (beforeSnap.code !== 0) {
          return errorResult(`notification_bar_clear: screenshot failed: ${beforeSnap.stderr || beforeSnap.stdout}`);
        }

        // Tap at the debug icons area to dismiss/minimize the notification bar
        const tap = await nativeTap(udid, 50, 850, { bundleId });
        if (!tap.ok) {
          return errorResult(`notification_bar_clear: tap failed (backend: ${tap.backend}): ${tap.detail}`);
        }

        // Wait for dismissal animation
        await new Promise<void>((resolve) => setTimeout(resolve, 500));

        // Take after screenshot
        const afterSnap = await run("xcrun", ["simctl", "io", udid, "screenshot", afterPath], { timeout: 15_000 });
        if (afterSnap.code !== 0) {
          return errorResult(`notification_bar_clear: after screenshot failed: ${afterSnap.stderr || afterSnap.stdout}`);
        }

        // Compare sizes to determine if screen changed
        let cleared = false;
        try {
          const beforeSize = (await stat(beforePath)).size;
          const afterSize = (await stat(afterPath)).size;
          const delta = Math.abs(afterSize - beforeSize);
          const threshold = Math.max(beforeSize * 0.02, 1);
          cleared = delta > threshold;
        } catch {
          // stat failure — assume cleared
          cleared = true;
        }

        return okResult({ cleared, backend: tap.backend, method: "tap-debug-icons-area-50-850" });
      } finally {
        await unlink(beforePath).catch(() => undefined);
        await unlink(afterPath).catch(() => undefined);
      }
    }
  );
}

import { z } from "zod";
import { getHierarchy, runMaestroFlow } from "../lib/maestro.js";
import { errorResult, okResult } from "../lib/result.js";
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
];
/** Capitalize first letter for the YAML ("enter" → "Enter"); Maestro matches pressKey case-insensitively. */
function fmtKey(k) {
    return k.charAt(0).toUpperCase() + k.slice(1);
}
export function registerScreenTools(server) {
    // ─── inspect_screen ──────────────────────────────────────────────────────────
    server.tool("inspect_screen", "Returns the current view hierarchy for a booted iOS simulator or Android device via `maestro hierarchy`. " +
        "Use this to discover element text/IDs before targeting them with tap_on. " +
        "Note: WebGL canvas content is native-layer only; web views may show limited hierarchy.", {
        udid: z.string().describe("Simulator / device UDID (from device_list)"),
    }, async ({ udid }) => {
        const result = await getHierarchy(udid);
        if (!result.ok) {
            return errorResult(result.text);
        }
        return okResult(result.json);
    });
    // ─── tap_on ──────────────────────────────────────────────────────────────────
    server.tool("tap_on", "Tap, double-tap, or long-press an element on screen via an ephemeral Maestro flow. " +
        "Target by text (regex), accessibility id, or absolute x/y coordinates. " +
        "bundleId is REQUIRED — Maestro needs it for the appId flow header.", {
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
    }, async ({ udid, bundleId, text, id, x, y, double: isDouble, long: isLong, longDurationMs, index, timeoutMs }) => {
        // Validate: x/y pairing first (an x-only call is a malformed point, not a missing selector)
        if ((x !== undefined) !== (y !== undefined)) {
            return errorResult("tap_on: x and y must be provided together.");
        }
        const hasPoint = x !== undefined && y !== undefined;
        if (!text && !id && !hasPoint) {
            return errorResult("tap_on requires at least one of: text, id, or x+y coordinates.");
        }
        // Choose command
        let cmd;
        if (isLong) {
            cmd = "longPressOn";
        }
        else if (isDouble) {
            cmd = "doubleTapOn";
        }
        else {
            cmd = "tapOn";
        }
        // Build selector
        let selector;
        if (hasPoint) {
            selector = `{ point: "${x},${y}"${index !== undefined ? `, index: ${index}` : ""} }`;
        }
        else if (text && id) {
            selector = `{ text: ${JSON.stringify(text)}, id: ${JSON.stringify(id)}${index !== undefined ? `, index: ${index}` : ""} }`;
        }
        else if (text) {
            selector =
                index !== undefined
                    ? `{ text: ${JSON.stringify(text)}, index: ${index} }`
                    : JSON.stringify(text);
        }
        else {
            // id only
            selector =
                index !== undefined
                    ? `{ id: ${JSON.stringify(id)}, index: ${index} }`
                    : `{ id: ${JSON.stringify(id)} }`;
        }
        // longPressDuration option
        const durationLine = isLong && longDurationMs !== undefined
            ? `  longPressTimeout: ${longDurationMs}\n`
            : "";
        const yaml = [
            `appId: ${bundleId}`,
            `---`,
            `- launchApp:`,
            `    stopApp: false`,
            `- ${cmd}: ${selector}`,
            durationLine ? durationLine.trimEnd() : "",
        ]
            .filter((l) => l !== "")
            .join("\n");
        try {
            const result = await runMaestroFlow({ udid, yaml, timeoutMs: timeoutMs ?? 30_000 });
            if (!result.passed) {
                return errorResult(`tap_on flow did not pass (retries: ${result.retries}):\n${result.rawOutput}`);
            }
            return okResult({ ok: true, cmd, selector, retries: result.retries, steps: result.steps });
        }
        catch (err) {
            return errorResult(`tap_on failed: ${String(err)}`);
        }
    });
    // ─── input_text ──────────────────────────────────────────────────────────────
    server.tool("input_text", "Types text into the currently-focused element via an ephemeral Maestro flow. " +
        "Set submit:true to press Enter after typing. Note: Android does not support Unicode via inputText.", {
        udid: z.string().describe("Simulator / device UDID"),
        bundleId: z.string().describe("App bundle identifier"),
        text: z.string().describe("Text to type"),
        submit: z.boolean().optional().describe("Press Enter after typing (default false)"),
        timeoutMs: z.number().int().optional().describe("Flow timeout in ms"),
    }, async ({ udid, bundleId, text, submit, timeoutMs }) => {
        const lines = [
            `appId: ${bundleId}`,
            `---`,
            `- launchApp:`,
            `    stopApp: false`,
            `- inputText: ${JSON.stringify(text)}`,
        ];
        if (submit) {
            lines.push(`- pressKey: "Enter"`);
        }
        const yaml = lines.join("\n");
        try {
            const result = await runMaestroFlow({ udid, yaml, timeoutMs: timeoutMs ?? 30_000 });
            if (!result.passed) {
                return errorResult(`input_text flow did not pass (retries: ${result.retries}):\n${result.rawOutput}`);
            }
            return okResult({ ok: true, text, submit: submit ?? false, retries: result.retries });
        }
        catch (err) {
            return errorResult(`input_text failed: ${String(err)}`);
        }
    });
    // ─── swipe ───────────────────────────────────────────────────────────────────
    server.tool("swipe", "Swipes in a direction or between two coordinates via an ephemeral Maestro flow. " +
        "direction is always required; startX/startY/endX/endY are optional overrides " +
        "expressed as percentage strings (e.g. '10%,50%') or pixel values.", {
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
    }, async ({ udid, bundleId, direction, startX, startY, endX, endY, timeoutMs }) => {
        let swipeLine;
        if (startX !== undefined && startY !== undefined && endX !== undefined && endY !== undefined) {
            swipeLine = `- swipe:\n    start: "${startX},${startY}"\n    end: "${endX},${endY}"`;
        }
        else {
            swipeLine = `- swipe:\n    direction: ${direction.toUpperCase()}`;
        }
        const yaml = [
            `appId: ${bundleId}`,
            `---`,
            `- launchApp:`,
            `    stopApp: false`,
            swipeLine,
        ].join("\n");
        try {
            const result = await runMaestroFlow({ udid, yaml, timeoutMs: timeoutMs ?? 30_000 });
            if (!result.passed) {
                return errorResult(`swipe flow did not pass (retries: ${result.retries}):\n${result.rawOutput}`);
            }
            return okResult({ ok: true, direction, retries: result.retries });
        }
        catch (err) {
            return errorResult(`swipe failed: ${String(err)}`);
        }
    });
    // ─── press_key ───────────────────────────────────────────────────────────────
    server.tool("press_key", "Presses a hardware or system key via an ephemeral Maestro flow. " +
        "back/power/tab are Android-only. " +
        "Valid keys: " + KEY_VALUES.join(", "), {
        udid: z.string().describe("Simulator / device UDID"),
        bundleId: z.string().describe("App bundle identifier"),
        key: z.enum(KEY_VALUES).describe("Key to press"),
        timeoutMs: z.number().int().optional().describe("Flow timeout in ms"),
    }, async ({ udid, bundleId, key, timeoutMs }) => {
        const yaml = [
            `appId: ${bundleId}`,
            `---`,
            `- launchApp:`,
            `    stopApp: false`,
            `- pressKey: ${JSON.stringify(fmtKey(key))}`,
        ].join("\n");
        try {
            const result = await runMaestroFlow({ udid, yaml, timeoutMs: timeoutMs ?? 15_000 });
            if (!result.passed) {
                return errorResult(`press_key flow did not pass (retries: ${result.retries}):\n${result.rawOutput}`);
            }
            return okResult({ ok: true, key, retries: result.retries });
        }
        catch (err) {
            return errorResult(`press_key failed: ${String(err)}`);
        }
    });
    // ─── orientation_set ─────────────────────────────────────────────────────────
    const ORIENTATION_VALUES = [
        "PORTRAIT",
        "LANDSCAPE_LEFT",
        "LANDSCAPE_RIGHT",
        "UPSIDE_DOWN",
    ];
    server.tool("orientation_set", "Sets the screen orientation on an iOS simulator via an ephemeral Maestro flow. " +
        "bundleId is required (Maestro needs it for the appId flow header). " +
        "Valid values: " + ORIENTATION_VALUES.join(", "), {
        udid: z.string().describe("Simulator / device UDID"),
        bundleId: z.string().describe("App bundle identifier"),
        value: z
            .enum(ORIENTATION_VALUES)
            .describe("Target orientation: PORTRAIT | LANDSCAPE_LEFT | LANDSCAPE_RIGHT | UPSIDE_DOWN"),
        timeoutMs: z.number().int().optional().describe("Flow timeout in ms"),
    }, async ({ udid, bundleId, value, timeoutMs }) => {
        const yaml = [
            `appId: ${bundleId}`,
            `---`,
            `- launchApp:`,
            `    stopApp: false`,
            `- setOrientation: ${value}`,
        ].join("\n");
        try {
            const result = await runMaestroFlow({ udid, yaml, timeoutMs: timeoutMs ?? 15_000 });
            if (!result.passed) {
                return errorResult(`orientation_set flow did not pass (retries: ${result.retries}):\n${result.rawOutput}`);
            }
            return okResult({ ok: true, value, retries: result.retries });
        }
        catch (err) {
            return errorResult(`orientation_set failed: ${String(err)}`);
        }
    });
}

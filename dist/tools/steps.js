import { z } from "zod";
import os from "node:os";
import path from "node:path";
import { stat } from "node:fs/promises";
import { getBackend, findElements, elementCenter, } from "../lib/native.js";
import { nativeTap, resolveForegroundApp } from "../lib/gesture.js";
import { runMaestroFlow } from "../lib/maestro.js";
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
];
/** Capitalize for the Maestro YAML ("enter" → "Enter"); Maestro matches case-insensitively. */
function fmtKey(k) {
    return k.charAt(0).toUpperCase() + k.slice(1);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// ─── Step schema (discriminated union on `action`) ────────────────────────────
const stepSchema = z.discriminatedUnion("action", [
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
        text: z.string().optional().describe("Element text/regex (Maestro semantics)"),
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
// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Poll the native element tree (or a one-shot Maestro assert) until `text` is visible. */
async function pollVisible(udid, be, text, timeoutMs, bundleId) {
    const start = Date.now();
    for (;;) {
        if (be) {
            const els = await be.describeAll(udid);
            if (els && findElements(els, { text }).length > 0)
                return true;
        }
        else {
            const appId = bundleId ?? (await resolveForegroundApp(udid));
            if (appId) {
                const yaml = `appId: ${appId}\n---\n- assertVisible: ${JSON.stringify(text)}`;
                const m = await runMaestroFlow({ udid, yaml, timeoutMs: 5_000 }).catch(() => null);
                if (m?.passed)
                    return true;
            }
        }
        if (Date.now() - start >= timeoutMs)
            return false;
        await sleep(400);
    }
}
/** appId for a Maestro fallback: explicit bundleId, else the foreground app. */
async function appIdFor(udid, bundleId) {
    return bundleId ?? (await resolveForegroundApp(udid));
}
// ─── Step executor ──────────────────────────────────────────────────────────
async function execStep(udid, bundleId, be, step, i) {
    switch (step.action) {
        case "tap": {
            const r = await nativeTap(udid, step.x, step.y, { bundleId });
            return { i, action: "tap", ok: r.ok, backend: r.backend, at: { x: step.x, y: step.y }, detail: r.detail };
        }
        case "tapText": {
            if (!step.text && !step.id) {
                return { i, action: "tapText", ok: false, error: "tapText requires text or id" };
            }
            // Native: resolve element center, then native tap.
            if (be) {
                const els = await be.describeAll(udid);
                if (els) {
                    const match = findElements(els, { text: step.text, id: step.id })[step.index ?? 0];
                    const pt = match ? elementCenter(match) : null;
                    if (pt) {
                        const r = await be.tap(udid, pt.x, pt.y);
                        if (r.code === 0) {
                            return { i, action: "tapText", ok: true, backend: be.name, tappedAt: pt };
                        }
                    }
                }
            }
            // Maestro fallback.
            const appId = await appIdFor(udid, bundleId);
            if (!appId) {
                return {
                    i,
                    action: "tapText",
                    ok: false,
                    error: "element not found natively and no appId for Maestro fallback — pass bundleId or use {action:'tap', x, y}",
                };
            }
            const selector = step.text && step.id
                ? `{ text: ${JSON.stringify(step.text)}, id: ${JSON.stringify(step.id)}${step.index !== undefined ? `, index: ${step.index}` : ""} }`
                : step.text
                    ? step.index !== undefined
                        ? `{ text: ${JSON.stringify(step.text)}, index: ${step.index} }`
                        : JSON.stringify(step.text)
                    : `{ id: ${JSON.stringify(step.id)} }`;
            const yaml = [`appId: ${appId}`, `---`, `- tapOn: ${selector}`].join("\n");
            const m = await runMaestroFlow({ udid, yaml, timeoutMs: 30_000 });
            return m.passed
                ? { i, action: "tapText", ok: true, backend: "maestro", selector }
                : { i, action: "tapText", ok: false, backend: "maestro", error: m.rawOutput.slice(0, 200) };
        }
        case "type": {
            if (be) {
                const r = await be.inputText(udid, step.text);
                if (r.code === 0) {
                    if (!step.submit)
                        return { i, action: "type", ok: true, backend: be.name };
                    if (be.canPressKey("enter")) {
                        const k = await be.pressKey(udid, "enter");
                        if (k && k.code === 0)
                            return { i, action: "type", ok: true, backend: be.name, submit: true };
                    }
                    const appId = await appIdFor(udid, bundleId);
                    if (appId) {
                        const m = await runMaestroFlow({
                            udid,
                            yaml: `appId: ${appId}\n---\n- pressKey: "Enter"`,
                            timeoutMs: 15_000,
                        });
                        return { i, action: "type", ok: m.passed, backend: `${be.name}+maestro`, submit: true };
                    }
                    return {
                        i,
                        action: "type",
                        ok: true,
                        backend: be.name,
                        submit: false,
                        detail: "typed; Enter skipped (no native mapping and no appId)",
                    };
                }
            }
            // Maestro fallback.
            const appId = await appIdFor(udid, bundleId);
            if (!appId) {
                return { i, action: "type", ok: false, error: "native inputText unavailable and no appId for Maestro fallback" };
            }
            const lines = [`appId: ${appId}`, `---`, `- inputText: ${JSON.stringify(step.text)}`];
            if (step.submit)
                lines.push(`- pressKey: "Enter"`);
            const m = await runMaestroFlow({ udid, yaml: lines.join("\n"), timeoutMs: 30_000 });
            return m.passed
                ? { i, action: "type", ok: true, backend: "maestro", submit: step.submit ?? false }
                : { i, action: "type", ok: false, backend: "maestro", error: m.rawOutput.slice(0, 200) };
        }
        case "key": {
            if (be && be.canPressKey(step.key)) {
                const r = await be.pressKey(udid, step.key);
                if (r && r.code === 0)
                    return { i, action: "key", ok: true, backend: be.name, key: step.key };
            }
            const appId = await appIdFor(udid, bundleId);
            if (!appId) {
                return { i, action: "key", ok: false, key: step.key, error: "no native mapping and no appId for Maestro fallback" };
            }
            const m = await runMaestroFlow({
                udid,
                yaml: `appId: ${appId}\n---\n- pressKey: ${JSON.stringify(fmtKey(step.key))}`,
                timeoutMs: 15_000,
            });
            return m.passed
                ? { i, action: "key", ok: true, backend: "maestro", key: step.key }
                : { i, action: "key", ok: false, backend: "maestro", key: step.key, error: m.rawOutput.slice(0, 200) };
        }
        case "swipe": {
            if (be) {
                const dims = await be.screenPoints(udid);
                if (dims) {
                    let pts = null;
                    if (step.startX !== undefined &&
                        step.startY !== undefined &&
                        step.endX !== undefined &&
                        step.endY !== undefined) {
                        pts = { x1: step.startX, y1: step.startY, x2: step.endX, y2: step.endY };
                    }
                    else {
                        const dir = step.direction ?? "up";
                        const cx = dims.w / 2;
                        const cy = dims.h / 2;
                        pts =
                            dir === "up"
                                ? { x1: cx, y1: dims.h * 0.7, x2: cx, y2: dims.h * 0.3 }
                                : dir === "down"
                                    ? { x1: cx, y1: dims.h * 0.3, x2: cx, y2: dims.h * 0.7 }
                                    : dir === "left"
                                        ? { x1: dims.w * 0.8, y1: cy, x2: dims.w * 0.2, y2: cy }
                                        : { x1: dims.w * 0.2, y1: cy, x2: dims.w * 0.8, y2: cy };
                    }
                    const r = await be.swipe(udid, pts.x1, pts.y1, pts.x2, pts.y2);
                    if (r.code === 0)
                        return { i, action: "swipe", ok: true, backend: be.name, points: pts };
                }
            }
            const appId = await appIdFor(udid, bundleId);
            if (!appId) {
                return { i, action: "swipe", ok: false, error: "native swipe unavailable and no appId for Maestro fallback" };
            }
            const swipeLine = step.startX !== undefined && step.startY !== undefined && step.endX !== undefined && step.endY !== undefined
                ? `- swipe:\n    start: "${step.startX},${step.startY}"\n    end: "${step.endX},${step.endY}"`
                : `- swipe:\n    direction: ${(step.direction ?? "up").toUpperCase()}`;
            const m = await runMaestroFlow({ udid, yaml: `appId: ${appId}\n---\n${swipeLine}`, timeoutMs: 30_000 });
            return m.passed
                ? { i, action: "swipe", ok: true, backend: "maestro" }
                : { i, action: "swipe", ok: false, backend: "maestro", error: m.rawOutput.slice(0, 200) };
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
            if (!r.ok)
                return { i, action: "screenshot", ok: false, error: r.stderr || r.stdout };
            let byteSize = null;
            try {
                byteSize = (await stat(out)).size;
            }
            catch {
                // non-fatal
            }
            return { i, action: "screenshot", ok: true, path: out, byteSize };
        }
    }
}
// ─── Tool registration ────────────────────────────────────────────────────────
export function registerStepsTools(server) {
    server.tool("run_steps", "Execute an ordered batch of UI actions in ONE call via the native backend " +
        "(idb/mobilecli, sub-second; Maestro fallback per step). Eliminates per-gesture MCP " +
        "round-trips for fast continuous flows (login, navigation, form fill). " +
        "Step actions: tap {x,y} · tapText {text|id} · type {text,submit} · key · swipe · " +
        "waitFor {text,timeoutMs} · assertVisible {text} · waitMs · screenshot. " +
        "Prefer `waitFor` over `waitMs` to act the instant the UI is ready instead of sleeping. " +
        "WebView note: web-rendered text is invisible to tapText — use tap {x,y} for it; `type` " +
        "uses real keystrokes so React onChange fires. Stops at the first failed step unless " +
        "stopOnError:false. bundleId is only needed for the Maestro fallback (auto-detected otherwise).", {
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
    }, async ({ udid, bundleId, steps, stopOnError, stepDelayMs }) => {
        const be = await getBackend();
        const results = [];
        let allOk = true;
        let failedAtIndex = null;
        for (let i = 0; i < steps.length; i++) {
            let res;
            try {
                res = await execStep(udid, bundleId, be, steps[i], i);
            }
            catch (err) {
                res = { i, action: steps[i].action, ok: false, error: String(err) };
            }
            results.push(res);
            if (!res.ok) {
                allOk = false;
                if (failedAtIndex === null)
                    failedAtIndex = i;
                if (stopOnError !== false)
                    break;
            }
            if (stepDelayMs && stepDelayMs > 0)
                await sleep(stepDelayMs);
        }
        return okResult({
            ok: allOk,
            backend: be?.name ?? "maestro",
            total: steps.length,
            ran: results.length,
            ...(failedAtIndex !== null ? { failedAtIndex } : {}),
            results,
        });
    });
}

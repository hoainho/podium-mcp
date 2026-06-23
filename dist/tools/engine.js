/**
 * Game-engine automation tools (v0.3.0 story C2).
 *
 * engine_inspect / engine_tap / engine_swipe / engine_call drive Unity/GL UIs as
 * addressable objects (by name/path/component/text) with absolute screen
 * coordinates — DOM-like, NO vision/screenshots. They connect to a live
 * AltTester server (via forwarded port) and FAIL CLOSED with an actionable
 * error when no instrumented build is reachable.
 *
 * The transport factory is injectable (_setEngineTransportFactory) so the tool
 * logic is unit-testable with a mock; the real WebSocket transport is validated
 * against a live instrumented build (hardware-gated — prd.json story C4).
 */
import { z } from "zod";
import { errorResult, okResult } from "../lib/result.js";
import { detectPlatform } from "../lib/device-target.js";
import { EngineClient, EngineError, forwardEnginePort, ENGINE_DEFAULT_PORT, } from "../lib/engine.js";
import { createEngineTransport } from "../lib/engine-transport.js";
let transportFactory = (host, port) => createEngineTransport(host, port);
/** Test seam: override the transport factory (null restores the real WebSocket one). */
export function _setEngineTransportFactory(factory) {
    transportFactory = factory ?? ((host, port) => createEngineTransport(host, port));
}
const INSTRUMENT_NOTE = " Requires an AltTester-instrumented build (dev/staging) with the in-app server running — " +
    "production App Store builds are not instrumented. Uses no screenshots/vision.";
const BY = z.enum(["name", "path", "component", "text", "id"]);
async function connectEngine(udid) {
    const platform = detectPlatform(udid);
    const forwarded = await forwardEnginePort(platform, udid);
    if (!forwarded) {
        throw new EngineError(`could not forward the engine port for ${udid} (adb forward / iproxy failed). Is the device connected?`);
    }
    let transport;
    try {
        transport = await transportFactory("127.0.0.1", ENGINE_DEFAULT_PORT);
    }
    catch (e) {
        throw new EngineError(`no AltTester server reachable on ${udid}. The app under test must be an AltTester-instrumented build with the server running.${e instanceof Error ? " (" + e.message + ")" : ""}`);
    }
    return new EngineClient(transport);
}
function engineErrorResult(e) {
    if (e instanceof EngineError)
        return errorResult(e.message);
    return errorResult(`engine error: ${e instanceof Error ? e.message : String(e)}`);
}
export function registerEngineTools(server) {
    server.tool("engine_inspect", "Lists game-engine (Unity/GL) objects matching a selector, each with absolute screen coordinates for tapping — DOM-like addressing with NO vision." +
        INSTRUMENT_NOTE, {
        udid: z.string().describe("Device UDID / Android serial"),
        by: BY.optional().describe("Selector kind (default: name)"),
        value: z.string().describe("Selector value (object name, hierarchy path, component, or text)"),
    }, async ({ udid, by, value }) => {
        let client = null;
        try {
            client = await connectEngine(udid);
            const objects = await client.findObjects((by ?? "name"), value);
            return okResult({ count: objects.length, objects });
        }
        catch (e) {
            return engineErrorResult(e);
        }
        finally {
            await client?.close();
        }
    });
    server.tool("engine_tap", "Taps a game-engine object resolved by selector (engine-reported screen coords, no vision)." + INSTRUMENT_NOTE, {
        udid: z.string().describe("Device UDID / Android serial"),
        by: BY.optional(),
        value: z.string().describe("Selector value identifying the object to tap"),
    }, async ({ udid, by, value }) => {
        let client = null;
        try {
            client = await connectEngine(udid);
            const objects = await client.findObjects((by ?? "name"), value);
            if (objects.length === 0)
                return errorResult(`no engine object matched ${by ?? "name"}="${value}"`);
            await client.tap(objects[0]);
            return okResult({ ok: true, tapped: objects[0] });
        }
        catch (e) {
            return engineErrorResult(e);
        }
        finally {
            await client?.close();
        }
    });
    server.tool("engine_swipe", "Swipes between two screen coordinates inside a game-engine view." + INSTRUMENT_NOTE, {
        udid: z.string().describe("Device UDID / Android serial"),
        fromX: z.number(),
        fromY: z.number(),
        toX: z.number(),
        toY: z.number(),
        durationMs: z.number().int().positive().optional().describe("Swipe duration in ms (default 300)"),
    }, async ({ udid, fromX, fromY, toX, toY, durationMs }) => {
        let client = null;
        try {
            client = await connectEngine(udid);
            await client.swipe({ x: fromX, y: fromY }, { x: toX, y: toY }, durationMs ?? 300);
            return okResult({ ok: true });
        }
        catch (e) {
            return engineErrorResult(e);
        }
        finally {
            await client?.close();
        }
    });
    server.tool("engine_call", "Invokes a C# component method on a game-engine object by reflection — the engine analog of firing a DOM event handler." +
        INSTRUMENT_NOTE, {
        udid: z.string().describe("Device UDID / Android serial"),
        by: BY.optional(),
        value: z.string().describe("Selector value identifying the object"),
        component: z.string().describe("Component (script) name, e.g. ScoreController"),
        method: z.string().describe("Method name to invoke"),
        parameters: z.array(z.unknown()).optional().describe("Method parameters (default none)"),
    }, async ({ udid, by, value, component, method, parameters }) => {
        let client = null;
        try {
            client = await connectEngine(udid);
            const objects = await client.findObjects((by ?? "name"), value);
            if (objects.length === 0)
                return errorResult(`no engine object matched ${by ?? "name"}="${value}"`);
            const result = await client.callComponentMethod(objects[0], component, method, parameters ?? []);
            return okResult({ ok: true, result });
        }
        catch (e) {
            return engineErrorResult(e);
        }
        finally {
            await client?.close();
        }
    });
}

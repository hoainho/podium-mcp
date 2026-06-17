/**
 * Metro bundler inspector helpers.
 * Uses native fetch and native WebSocket (Node 18+). No new dependencies.
 */
/**
 * GET http://localhost:<port>/json — returns CDP inspector targets from Metro.
 * Connection refused → structured error, never throws.
 */
export async function listMetroApps(port = 8081) {
    try {
        const response = await fetch(`http://localhost:${port}/json`, {
            signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) {
            return { error: `metro responded with HTTP ${response.status} on port ${port}` };
        }
        const raw = (await response.json());
        if (!Array.isArray(raw)) {
            return { error: `metro /json response was not an array` };
        }
        return raw.map((entry) => ({
            id: String(entry["id"] ?? ""),
            description: String(entry["description"] ?? ""),
            title: String(entry["title"] ?? ""),
            webSocketDebuggerUrl: String(entry["webSocketDebuggerUrl"] ?? ""),
        }));
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Connection refused → nothing is listening: Metro is not running.
        if (msg.includes("ECONNREFUSED") ||
            msg.includes("fetch failed") ||
            msg.includes("connect") ||
            msg.includes("ENOENT")) {
            return { error: `metro not running on port ${port}` };
        }
        // Timed out → something answered slowly (or not at all) within 3s.
        if (msg.includes("TimeoutError") || msg.includes("timed out") || msg.includes("AbortError")) {
            return { error: `metro did not respond within 3s on port ${port} (slow or not running)` };
        }
        // Anything else (DNS, malformed payload, unexpected error) — surface it.
        return { error: `metro query failed on port ${port}: ${msg}` };
    }
}
/**
 * Opens a native WebSocket to a CDP debugger URL, sends Runtime.enable,
 * and collects Runtime.consoleAPICalled events for durationMs (default 3000 ms).
 * Caps at maxLogs (default 100, keeps most recent). Never throws.
 */
export async function readConsoleLogs(webSocketDebuggerUrl, opts = {}) {
    const maxLogs = opts.maxLogs ?? 100;
    const durationMs = opts.durationMs ?? 3000;
    return new Promise((resolve) => {
        let settled = false;
        const logs = [];
        function finish() {
            if (settled)
                return;
            settled = true;
            try {
                ws.close();
            }
            catch {
                // ignore
            }
            // Keep most recent maxLogs entries
            const trimmed = logs.length > maxLogs ? logs.slice(logs.length - maxLogs) : logs;
            resolve({ logs: trimmed });
        }
        let ws;
        try {
            ws = new WebSocket(webSocketDebuggerUrl);
        }
        catch (err) {
            return resolve({ error: `WebSocket error: ${err instanceof Error ? err.message : String(err)}` });
        }
        const timer = setTimeout(finish, durationMs);
        ws.addEventListener("open", () => {
            try {
                ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
            }
            catch (err) {
                clearTimeout(timer);
                settled = true;
                try {
                    ws.close();
                }
                catch {
                    // ignore — socket may already be dead
                }
                resolve({ error: `send failed: ${err instanceof Error ? err.message : String(err)}` });
            }
        });
        ws.addEventListener("message", (event) => {
            try {
                const msg = JSON.parse(String(event.data));
                if (msg["method"] === "Runtime.consoleAPICalled") {
                    const params = (msg["params"] ?? {});
                    const type = String(params["type"] ?? "log");
                    const timestamp = typeof params["timestamp"] === "number" ? params["timestamp"] : Date.now();
                    const argsRaw = Array.isArray(params["args"]) ? params["args"] : [];
                    const text = argsRaw
                        .map((a) => {
                        if (typeof a["value"] !== "undefined")
                            return String(a["value"]);
                        if (typeof a["description"] !== "undefined")
                            return String(a["description"]);
                        return JSON.stringify(a);
                    })
                        .join(" ");
                    logs.push({ level: type, ts: timestamp, text });
                }
            }
            catch {
                // malformed message — skip
            }
        });
        ws.addEventListener("error", () => {
            clearTimeout(timer);
            if (!settled) {
                settled = true;
                try {
                    ws.close();
                }
                catch {
                    // ignore
                }
                resolve({ error: `WebSocket connection failed to ${webSocketDebuggerUrl}` });
            }
        });
        ws.addEventListener("close", () => {
            clearTimeout(timer);
            finish();
        });
    });
}
/**
 * Parse a CDP Runtime.evaluate response (id===1) into a value or error.
 * Pure + exported so the response handling is unit-testable.
 */
export function parseEvalResponse(msg) {
    const result = (msg["result"] ?? {});
    const exceptionDetails = result["exceptionDetails"];
    if (exceptionDetails) {
        const ex = exceptionDetails;
        return { error: `evaluation threw: ${String(ex["text"] ?? "exception")}` };
    }
    const inner = (result["result"] ?? {});
    if ("value" in inner)
        return { value: inner["value"] };
    if ("description" in inner)
        return { value: String(inner["description"]) };
    return { value: null };
}
/**
 * Evaluate a JS expression in the RN runtime via CDP Runtime.evaluate
 * (returnByValue, awaitPromise). Resolves the value or a structured error.
 * Never throws.
 */
export async function evalRuntime(webSocketDebuggerUrl, expression, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 5000;
    return new Promise((resolve) => {
        let settled = false;
        function done(r) {
            if (settled)
                return;
            settled = true;
            try {
                ws.close();
            }
            catch {
                // ignore
            }
            resolve(r);
        }
        let ws;
        try {
            ws = new WebSocket(webSocketDebuggerUrl);
        }
        catch (err) {
            return resolve({ error: `WebSocket error: ${err instanceof Error ? err.message : String(err)}` });
        }
        const timer = setTimeout(() => done({ error: `Runtime.evaluate timed out after ${timeoutMs}ms` }), timeoutMs);
        ws.addEventListener("open", () => {
            try {
                ws.send(JSON.stringify({
                    id: 1,
                    method: "Runtime.evaluate",
                    params: { expression, returnByValue: true, awaitPromise: true },
                }));
            }
            catch (err) {
                clearTimeout(timer);
                done({ error: `send failed: ${err instanceof Error ? err.message : String(err)}` });
            }
        });
        ws.addEventListener("message", (event) => {
            try {
                const msg = JSON.parse(String(event.data));
                if (msg["id"] === 1) {
                    clearTimeout(timer);
                    done(parseEvalResponse(msg));
                }
            }
            catch {
                // ignore malformed
            }
        });
        ws.addEventListener("error", () => {
            clearTimeout(timer);
            done({ error: `WebSocket connection failed to ${webSocketDebuggerUrl}` });
        });
    });
}
/**
 * Fold raw CDP Network.* events into merged request entries keyed by requestId.
 * Pure + exported so the parsing is unit-testable without a live WebSocket.
 * Pairs Network.requestWillBeSent (url/method/ts) with Network.responseReceived
 * (status/mimeType); either may arrive first.
 */
/** Coerce a CDP headers object ({name: value}) into a string map. */
function toHeaderMap(h) {
    const out = {};
    if (h && typeof h === "object") {
        for (const [k, v] of Object.entries(h))
            out[k] = String(v);
    }
    return out;
}
export function foldNetworkEvents(messages) {
    const map = new Map();
    for (const msg of messages) {
        const method = msg["method"];
        const params = (msg["params"] ?? {});
        const id = String(params["requestId"] ?? "");
        if (!id)
            continue;
        if (method === "Network.requestWillBeSent") {
            const req = (params["request"] ?? {});
            const prev = map.get(id);
            map.set(id, {
                ...prev,
                requestId: id,
                url: String(req["url"] ?? prev?.url ?? ""),
                method: String(req["method"] ?? prev?.method ?? "GET"),
                ts: typeof params["timestamp"] === "number" ? params["timestamp"] : prev?.ts ?? 0,
                ...(typeof params["wallTime"] === "number" ? { wallTime: params["wallTime"] } : {}),
                ...(req["headers"] ? { requestHeaders: toHeaderMap(req["headers"]) } : {}),
                ...(typeof req["postData"] === "string" ? { postData: req["postData"] } : {}),
            });
        }
        else if (method === "Network.responseReceived") {
            const resp = (params["response"] ?? {});
            const prev = map.get(id) ?? { requestId: id, url: String(resp["url"] ?? ""), method: "GET", ts: 0 };
            map.set(id, {
                ...prev,
                ...(typeof resp["status"] === "number" ? { status: resp["status"] } : {}),
                ...(resp["statusText"] !== undefined ? { statusText: String(resp["statusText"]) } : {}),
                ...(resp["mimeType"] !== undefined ? { mimeType: String(resp["mimeType"]) } : {}),
                ...(resp["headers"] ? { responseHeaders: toHeaderMap(resp["headers"]) } : {}),
                ...(resp["timing"] && typeof resp["timing"] === "object"
                    ? { timing: resp["timing"] }
                    : {}),
                ...(typeof resp["encodedDataLength"] === "number"
                    ? { encodedDataLength: resp["encodedDataLength"] }
                    : {}),
            });
        }
    }
    return Array.from(map.values());
}
/**
 * Opens a native WebSocket to a CDP debugger URL, sends Network.enable, and
 * collects Network.requestWillBeSent / Network.responseReceived events for
 * durationMs (default 3000). Caps at maxEntries (default 100, most recent).
 * Never throws. Mirrors readConsoleLogs' lifecycle.
 */
export async function readNetwork(webSocketDebuggerUrl, opts = {}) {
    const maxEntries = opts.maxEntries ?? 100;
    const durationMs = opts.durationMs ?? 3000;
    return new Promise((resolve) => {
        let settled = false;
        const raw = [];
        function finish() {
            if (settled)
                return;
            settled = true;
            try {
                ws.close();
            }
            catch {
                // ignore
            }
            const requests = foldNetworkEvents(raw);
            const trimmed = requests.length > maxEntries ? requests.slice(requests.length - maxEntries) : requests;
            resolve({ requests: trimmed });
        }
        let ws;
        try {
            ws = new WebSocket(webSocketDebuggerUrl);
        }
        catch (err) {
            return resolve({ error: `WebSocket error: ${err instanceof Error ? err.message : String(err)}` });
        }
        const timer = setTimeout(finish, durationMs);
        ws.addEventListener("open", () => {
            try {
                ws.send(JSON.stringify({ id: 1, method: "Network.enable" }));
            }
            catch (err) {
                clearTimeout(timer);
                settled = true;
                try {
                    ws.close();
                }
                catch {
                    // ignore
                }
                resolve({ error: `send failed: ${err instanceof Error ? err.message : String(err)}` });
            }
        });
        ws.addEventListener("message", (event) => {
            try {
                const msg = JSON.parse(String(event.data));
                const m = msg["method"];
                if (m === "Network.requestWillBeSent" || m === "Network.responseReceived") {
                    raw.push(msg);
                }
            }
            catch {
                // malformed message — skip
            }
        });
        ws.addEventListener("error", () => {
            clearTimeout(timer);
            if (!settled) {
                settled = true;
                try {
                    ws.close();
                }
                catch {
                    // ignore
                }
                resolve({ error: `WebSocket connection failed to ${webSocketDebuggerUrl}` });
            }
        });
        ws.addEventListener("close", () => {
            clearTimeout(timer);
            finish();
        });
    });
}

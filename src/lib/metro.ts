/**
 * Metro bundler inspector helpers.
 * Uses native fetch and native WebSocket (Node 18+). No new dependencies.
 */

export interface MetroApp {
  id: string;
  description: string;
  title: string;
  webSocketDebuggerUrl: string;
}

export interface MetroError {
  error: string;
}

export type MetroAppsResult = MetroApp[] | MetroError;

/**
 * GET http://localhost:<port>/json — returns CDP inspector targets from Metro.
 * Connection refused → structured error, never throws.
 */
export async function listMetroApps(port = 8081): Promise<MetroAppsResult> {
  try {
    const response = await fetch(`http://localhost:${port}/json`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return { error: `metro responded with HTTP ${response.status} on port ${port}` };
    }
    const raw = (await response.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(raw)) {
      return { error: `metro /json response was not an array` };
    }
    return raw.map((entry) => ({
      id: String(entry["id"] ?? ""),
      description: String(entry["description"] ?? ""),
      title: String(entry["title"] ?? ""),
      webSocketDebuggerUrl: String(entry["webSocketDebuggerUrl"] ?? ""),
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // ECONNREFUSED or similar network errors
    if (
      msg.includes("ECONNREFUSED") ||
      msg.includes("fetch failed") ||
      msg.includes("connect") ||
      msg.includes("ENOENT")
    ) {
      return { error: `metro not running on port ${port}` };
    }
    if (msg.includes("TimeoutError") || msg.includes("timed out") || msg.includes("AbortError")) {
      return { error: `metro not running on port ${port}` };
    }
    return { error: `metro not running on port ${port}` };
  }
}

// ─── CDP log collection ────────────────────────────────────────────────────────

export interface ConsoleLogEntry {
  level: string;
  ts: number;
  text: string;
}

export interface ReadConsoleLogsOpts {
  maxLogs?: number;
  durationMs?: number;
}

export type ReadConsoleLogsResult =
  | { logs: ConsoleLogEntry[] }
  | { error: string };

/**
 * Opens a native WebSocket to a CDP debugger URL, sends Runtime.enable,
 * and collects Runtime.consoleAPICalled events for durationMs (default 3000 ms).
 * Caps at maxLogs (default 100, keeps most recent). Never throws.
 */
export async function readConsoleLogs(
  webSocketDebuggerUrl: string,
  opts: ReadConsoleLogsOpts = {}
): Promise<ReadConsoleLogsResult> {
  const maxLogs = opts.maxLogs ?? 100;
  const durationMs = opts.durationMs ?? 3000;

  return new Promise<ReadConsoleLogsResult>((resolve) => {
    let settled = false;
    const logs: ConsoleLogEntry[] = [];

    function finish() {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        // ignore
      }
      // Keep most recent maxLogs entries
      const trimmed = logs.length > maxLogs ? logs.slice(logs.length - maxLogs) : logs;
      resolve({ logs: trimmed });
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(webSocketDebuggerUrl);
    } catch (err) {
      return resolve({ error: `WebSocket error: ${err instanceof Error ? err.message : String(err)}` });
    }

    const timer = setTimeout(finish, durationMs);

    ws.addEventListener("open", () => {
      try {
        ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
      } catch (err) {
        clearTimeout(timer);
        settled = true;
        try {
          ws.close();
        } catch {
          // ignore — socket may already be dead
        }
        resolve({ error: `send failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      try {
        const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (msg["method"] === "Runtime.consoleAPICalled") {
          const params = (msg["params"] ?? {}) as Record<string, unknown>;
          const type = String(params["type"] ?? "log");
          const timestamp = typeof params["timestamp"] === "number" ? params["timestamp"] : Date.now();
          const argsRaw = Array.isArray(params["args"]) ? params["args"] : [];
          const text = (argsRaw as Array<Record<string, unknown>>)
            .map((a) => {
              if (typeof a["value"] !== "undefined") return String(a["value"]);
              if (typeof a["description"] !== "undefined") return String(a["description"]);
              return JSON.stringify(a);
            })
            .join(" ");
          logs.push({ level: type, ts: timestamp, text });
        }
      } catch {
        // malformed message — skip
      }
    });

    ws.addEventListener("error", () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ error: `WebSocket connection failed to ${webSocketDebuggerUrl}` });
      }
    });

    ws.addEventListener("close", () => {
      clearTimeout(timer);
      finish();
    });
  });
}

export async function createEngineTransport(host, port, opts = {}) {
    const path = opts.path ?? "/altws/";
    const timeoutMs = opts.connectTimeoutMs ?? 5000;
    const ws = new WebSocket(`ws://${host}:${port}${path}`);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            ws.close();
            reject(new Error(`engine connect timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        ws.addEventListener("open", () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
        ws.addEventListener("error", () => {
            clearTimeout(timer);
            reject(new Error("engine connect failed (no AltTester server reachable)"));
        }, { once: true });
    });
    return {
        send(command) {
            return new Promise((resolve, reject) => {
                const onMessage = (event) => {
                    ws.removeEventListener("message", onMessage);
                    try {
                        const text = typeof event.data === "string" ? event.data : String(event.data);
                        resolve(JSON.parse(text));
                    }
                    catch (e) {
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

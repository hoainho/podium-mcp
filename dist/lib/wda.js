function asObj(x) {
    return x && typeof x === "object" ? x : null;
}
function asStr(x) {
    return typeof x === "string" ? x : undefined;
}
/**
 * Parse WDA `GET /source?format=json` (a nested accessibility tree) into a flat
 * NativeElement[]. Each node carries `type`, `label`/`name`/`value`, and a
 * `rect:{x,y,width,height}` → frame, so elementCenter()/findElements() work
 * identically to the iOS-sim path. Pure — exported for tests.
 */
export function parseWdaSource(json) {
    let root;
    try {
        root = JSON.parse(json);
    }
    catch {
        return [];
    }
    const out = [];
    const walk = (node) => {
        const n = asObj(node);
        if (!n)
            return;
        const label = asStr(n.label) ?? asStr(n.name) ?? asStr(n.value) ?? "";
        const id = asStr(n.name);
        if (label || id) {
            const el = { label };
            if (id)
                el.identifier = id;
            const t = asStr(n.type);
            if (t)
                el.type = t;
            const rect = asObj(n.rect);
            if (rect) {
                const x = Number(rect.x);
                const y = Number(rect.y);
                const w = Number(rect.width);
                const h = Number(rect.height);
                if ([x, y, w, h].every((v) => Number.isFinite(v))) {
                    el.frame = { x, y, width: w, height: h };
                }
            }
            out.push(el);
        }
        if (Array.isArray(n.children)) {
            for (const c of n.children)
                walk(c);
        }
    };
    walk(root);
    return out;
}
async function wdaRequest(fetchImpl, url, method, body) {
    try {
        const res = await fetchImpl(url, {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        return {
            code: res.ok ? 0 : 1,
            stdout: text,
            stderr: res.ok ? "" : `WDA ${method} ${url} -> ${res.status}`,
        };
    }
    catch (e) {
        return { code: 1, stdout: "", stderr: `WDA request failed: ${e instanceof Error ? e.message : String(e)}` };
    }
}
const WDA_KEY = {
    home: "home",
    enter: "\n",
    return: "\n",
};
/**
 * Build a WDA-backed NativeBackend. `baseUrl` is the WDA session base
 * (e.g. http://localhost:8100/session/<id>); `fetchImpl` is injectable for tests.
 */
export function makeWdaBackend(baseUrl, fetchImpl = fetch) {
    const base = baseUrl.replace(/\/$/, "");
    return {
        name: "wda",
        tap: (_udid, x, y) => wdaRequest(fetchImpl, `${base}/wda/tap/0`, "POST", { x, y }),
        swipe: (_udid, x1, y1, x2, y2, durationMs) => wdaRequest(fetchImpl, `${base}/wda/dragfromtoforduration`, "POST", {
            fromX: x1,
            fromY: y1,
            toX: x2,
            toY: y2,
            duration: (durationMs ?? 300) / 1000,
        }),
        inputText: (_udid, text) => wdaRequest(fetchImpl, `${base}/wda/keys`, "POST", { value: [text] }),
        canPressKey: (key) => key.trim().toLowerCase() in WDA_KEY,
        pressKey: async (_udid, key) => {
            const mapped = WDA_KEY[key.trim().toLowerCase()];
            if (mapped === undefined)
                return null;
            if (mapped === "home")
                return wdaRequest(fetchImpl, `${base}/wda/homescreen`, "POST");
            return wdaRequest(fetchImpl, `${base}/wda/keys`, "POST", { value: [mapped] });
        },
        describeAll: async () => {
            const r = await wdaRequest(fetchImpl, `${base}/source?format=json`, "GET");
            if (r.code !== 0)
                return null;
            return parseWdaSource(r.stdout);
        },
        screenPoints: async () => {
            const r = await wdaRequest(fetchImpl, `${base}/window/size`, "GET");
            if (r.code !== 0)
                return null;
            try {
                const v = asObj(JSON.parse(r.stdout));
                const val = asObj(v?.value);
                const w = Number(val?.width);
                const h = Number(val?.height);
                return Number.isFinite(w) && Number.isFinite(h) ? { w, h } : null;
            }
            catch {
                return null;
            }
        },
        setOrientation: async () => null, // real-device orientation falls back to Maestro
    };
}

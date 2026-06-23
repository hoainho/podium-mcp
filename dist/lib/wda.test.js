import { describe, it, expect, afterEach } from "vitest";
import { parseWdaSource, makeWdaBackend } from "./wda.js";
import { elementCenter, findElements, getBackendFor } from "./native.js";
const SOURCE = JSON.stringify({
    type: "Application",
    label: "App",
    rect: { x: 0, y: 0, width: 390, height: 844 },
    children: [
        { type: "Button", name: "signin", label: "Sign In", rect: { x: 20, y: 100, width: 350, height: 50 }, children: [] },
        { type: "StaticText", label: "Welcome", rect: { x: 20, y: 40, width: 200, height: 30 } },
        { type: "Other", rect: { x: 0, y: 0, width: 10, height: 10 } },
    ],
});
function mockFetch(handler) {
    const urls = [];
    const fetchImpl = async (url) => {
        urls.push(url);
        const r = handler(url);
        return { ok: r.ok, status: r.status, text: async () => r.body };
    };
    return { fetchImpl, urls };
}
describe("parseWdaSource", () => {
    it("flattens the WDA accessibility tree to NativeElements with frames", () => {
        const els = parseWdaSource(SOURCE);
        expect(els).toHaveLength(3); // App, Sign In, Welcome (the unlabeled Other is skipped)
        const signin = els.find((e) => e.identifier === "signin");
        expect(signin.label).toBe("Sign In");
        expect(signin.frame).toEqual({ x: 20, y: 100, width: 350, height: 50 });
    });
    it("frames drive elementCenter/findElements (parity with iOS-sim)", () => {
        const [signin] = findElements(parseWdaSource(SOURCE), { text: "Sign In" });
        expect(elementCenter(signin)).toEqual({ x: 195, y: 125 });
    });
    it("returns [] on bad JSON", () => {
        expect(parseWdaSource("not json")).toEqual([]);
    });
});
describe("makeWdaBackend", () => {
    it("declares name wda", () => {
        expect(makeWdaBackend("http://localhost:8100/session/x").name).toBe("wda");
    });
    it("describeAll GETs /source and parses it", async () => {
        const { fetchImpl, urls } = mockFetch((url) => url.includes("/source") ? { ok: true, status: 200, body: SOURCE } : { ok: true, status: 200, body: "{}" });
        const be = makeWdaBackend("http://localhost:8100/session/x", fetchImpl);
        const els = await be.describeAll("U1");
        expect(els).not.toBeNull();
        expect(els).toHaveLength(3);
        expect(urls[0]).toContain("/source");
    });
    it("tap POSTs the WDA tap endpoint and maps ok→code 0", async () => {
        const { fetchImpl, urls } = mockFetch(() => ({ ok: true, status: 200, body: "{}" }));
        const be = makeWdaBackend("http://localhost:8100/session/x", fetchImpl);
        const r = await be.tap("U1", 100, 200);
        expect(r.code).toBe(0);
        expect(urls[0]).toContain("/wda/tap/0");
    });
    it("fails closed: a fetch rejection becomes a non-zero RunResult", async () => {
        const fetchImpl = async () => {
            throw new Error("ECONNREFUSED");
        };
        const r = await makeWdaBackend("http://localhost:8100/session/x", fetchImpl).tap("U1", 1, 2);
        expect(r.code).toBe(1);
        expect(r.stderr).toMatch(/WDA request failed/);
    });
    it("describeAll returns null when WDA responds non-ok", async () => {
        const { fetchImpl } = mockFetch(() => ({ ok: false, status: 500, body: "err" }));
        expect(await makeWdaBackend("http://localhost:8100/session/x", fetchImpl).describeAll("U1")).toBeNull();
    });
    it("screenPoints parses the WDA window/size value", async () => {
        const { fetchImpl } = mockFetch(() => ({ ok: true, status: 200, body: JSON.stringify({ value: { width: 390, height: 844 } }) }));
        expect(await makeWdaBackend("http://localhost:8100/session/x", fetchImpl).screenPoints("U1")).toEqual({
            w: 390,
            h: 844,
        });
    });
});
describe("getBackendFor ios-real WDA opt-in", () => {
    const prev = process.env.PODIUM_WDA_URL;
    afterEach(() => {
        if (prev === undefined)
            delete process.env.PODIUM_WDA_URL;
        else
            process.env.PODIUM_WDA_URL = prev;
    });
    it("returns the WDA backend when PODIUM_WDA_URL is set", async () => {
        process.env.PODIUM_WDA_URL = "http://localhost:8100/session/abc";
        const be = await getBackendFor("ios-real");
        expect(be?.name).toBe("wda");
    });
});

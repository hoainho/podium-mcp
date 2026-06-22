import { describe, it, expect } from "vitest";
import { toHar } from "./har.js";
const entry = {
    requestId: "1",
    url: "https://api.test/v1/users?page=2&q=hi",
    method: "POST",
    status: 200,
    statusText: "OK",
    mimeType: "application/json",
    ts: 100,
    wallTime: 1_700_000_000,
    requestHeaders: { Authorization: "Bearer SECRET-TOKEN", "Content-Type": "application/json", Accept: "*/*" },
    responseHeaders: { "Set-Cookie": "sid=abc; HttpOnly", "Content-Type": "application/json" },
    postData: '{"name":"x"}',
    timing: { dnsStart: 0, dnsEnd: 5, connectStart: 5, connectEnd: 15, sslStart: 8, sslEnd: 15, sendStart: 15, sendEnd: 16, receiveHeadersEnd: 40 },
    encodedDataLength: 1234,
};
describe("toHar", () => {
    it("emits a valid HAR 1.2 log shape", () => {
        const har = toHar([entry]);
        expect(har.log.version).toBe("1.2");
        expect(har.log.creator.name).toBe("podium-mcp");
        expect(har.log.entries).toHaveLength(1);
        const e = har.log.entries[0];
        expect(e.request.method).toBe("POST");
        expect(e.request.url).toContain("/v1/users");
        expect(e.response.status).toBe(200);
        expect(e.response.content.mimeType).toBe("application/json");
        expect(e.startedDateTime).toBe(new Date(1_700_000_000 * 1000).toISOString());
    });
    it("parses queryString from the url", () => {
        const e = toHar([entry]).log.entries[0];
        expect(e.request.queryString).toEqual([
            { name: "page", value: "2" },
            { name: "q", value: "hi" },
        ]);
    });
    it("derives timings from the CDP ResourceTiming object", () => {
        const t = toHar([entry]).log.entries[0].timings;
        expect(t.dns).toBe(5); // dnsEnd - dnsStart
        expect(t.connect).toBe(10); // connectEnd - connectStart
        expect(t.ssl).toBe(7);
        expect(t.send).toBe(1);
        expect(t.wait).toBe(24); // receiveHeadersEnd - sendEnd
    });
    it("REDACTS sensitive headers by default (no token survives)", () => {
        const har = toHar([entry]);
        const json = JSON.stringify(har);
        expect(json).not.toContain("SECRET-TOKEN");
        expect(json).not.toContain("sid=abc");
        const reqAuth = har.log.entries[0].request.headers.find((h) => h.name.toLowerCase() === "authorization");
        expect(reqAuth?.value).toBe("***REDACTED***");
        const setCookie = har.log.entries[0].response.headers.find((h) => h.name.toLowerCase() === "set-cookie");
        expect(setCookie?.value).toBe("***REDACTED***");
        // non-sensitive headers pass through
        expect(har.log.entries[0].request.headers.find((h) => h.name === "Accept")?.value).toBe("*/*");
    });
    it("keeps sensitive headers when redact:false", () => {
        const json = JSON.stringify(toHar([entry], { redact: false }));
        expect(json).toContain("Bearer SECRET-TOKEN");
    });
    it("supports extra redacted header names", () => {
        const e = { ...entry, requestHeaders: { "X-Custom-Secret": "leak-me" } };
        const har = toHar([e], { redactHeaders: ["x-custom-secret"] });
        expect(JSON.stringify(har)).not.toContain("leak-me");
    });
});

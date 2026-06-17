#!/usr/bin/env node
/**
 * Live proof: drive the real webview_network TOOL handler against the booted
 * WKWebView fixture and write a real .har. The fixture fires periodic same-origin
 * requests (fixture.local — fail-closed, status 0) carrying an Authorization
 * header + POST body, so this exercises capture → HAR → redaction end-to-end.
 *
 * Run: node e2e/webview-network-live.mjs <udid>
 */
import { readFileSync } from "node:fs";
import { registerWebviewTools } from "../dist/tools/webview.js";

const UDID = process.argv[2] || "74DD7D29-38BC-4B82-B92A-FFA7E0C15F74";
const OUT = "/tmp/podium-webview-live.har";

const handlers = new Map();
registerWebviewTools({ tool: (name, _d, _s, fn) => handlers.set(name, fn) });

const res = await handlers.get("webview_network")({
  udid: UDID,
  durationMs: 4500,
  format: "har",
  saveTo: OUT,
});

const text = res.content[0].text;
if (res.isError) {
  console.error("webview_network ERROR:\n" + text);
  process.exit(1);
}
const payload = JSON.parse(text);
console.log(`webview_network OK — webviewId=${payload.webviewId} url=${payload.url}`);
console.log(`captured ${payload.count} entries · redacted=${payload.redacted} · savedTo=${payload.savedTo}`);

// Read the file back and prove (a) it's valid HAR with entries, (b) no secret survives.
const har = JSON.parse(readFileSync(OUT, "utf8"));
const entries = har.log.entries;
console.log(`\n.har on disk: version=${har.log.version} creator=${har.log.creator.name}@${har.log.creator.version} entries=${entries.length}`);
for (const e of entries.slice(0, 4)) {
  const auth = e.request.headers.find((h) => h.name === "Authorization");
  console.log(`  ${e.request.method.padEnd(4)} ${e.request.url}  status=${e.response.status} time=${e.time}ms  Authorization=${auth ? auth.value : "(none)"}${e.request.postData ? "  postData=" + e.request.postData.text : ""}`);
}
const raw = JSON.stringify(har);
const leaked = raw.includes("FIXTURE-TOKEN") || raw.includes('"amount":5');
console.log(`\nsecret leak check: ${leaked ? "❌ SECRET FOUND IN HAR" : "✅ no token / body survived redaction"}`);
process.exit(leaked || entries.length === 0 ? 1 : 0);

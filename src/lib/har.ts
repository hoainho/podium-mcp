/**
 * Pure HAR 1.2 emitter for captured network entries, with redaction-by-default.
 *
 * HAR (and the console logs alongside it) routinely contain auth tokens, cookies,
 * and PII — and engineers/QA save them into repos or attach them to tickets. So
 * sensitive headers are masked by default; pass `redact:false` to opt out.
 *
 * "HAR-lite": entries carry headers + timings but no response bodies (the body
 * capture requires the long-lived CDP session — Phase 2).
 */
import type { NetworkEntry } from "./metro.js";

const REDACTED = "***REDACTED***";

/** Header names whose values are masked by default (lower-cased match). */
const DEFAULT_SENSITIVE = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "api-key",
];

export interface HarNameValue {
  name: string;
  value: string;
}
export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: {
    method: string;
    url: string;
    httpVersion: string;
    headers: HarNameValue[];
    queryString: HarNameValue[];
    cookies: HarNameValue[];
    headersSize: number;
    bodySize: number;
    postData?: { mimeType: string; text: string };
  };
  response: {
    status: number;
    statusText: string;
    httpVersion: string;
    headers: HarNameValue[];
    cookies: HarNameValue[];
    content: { size: number; mimeType: string };
    redirectURL: string;
    headersSize: number;
    bodySize: number;
  };
  cache: Record<string, never>;
  timings: { blocked: number; dns: number; connect: number; ssl: number; send: number; wait: number; receive: number };
}
export interface HarLog {
  log: { version: "1.2"; creator: { name: string; version: string }; entries: HarEntry[] };
}

/** Mask sensitive header values + postData on raw NetworkEntry[] (for the JSON
 *  metro_network path, so redaction-by-default holds regardless of output format).
 *  Shares the HAR sensitive-key set. redact:false returns entries unchanged. */
export function redactNetworkEntries(
  entries: NetworkEntry[],
  opts: { redact?: boolean; redactHeaders?: string[] } = {}
): NetworkEntry[] {
  if (opts.redact === false) return entries;
  const sensitive = new Set([...DEFAULT_SENSITIVE, ...(opts.redactHeaders ?? []).map((h) => h.toLowerCase())]);
  const mask = (h?: Record<string, string>): Record<string, string> | undefined =>
    h ? Object.fromEntries(Object.entries(h).map(([k, v]) => [k, sensitive.has(k.toLowerCase()) ? REDACTED : v])) : h;
  return entries.map((e) => ({
    ...e,
    ...(e.requestHeaders ? { requestHeaders: mask(e.requestHeaders) } : {}),
    ...(e.responseHeaders ? { responseHeaders: mask(e.responseHeaders) } : {}),
    ...(e.postData !== undefined ? { postData: REDACTED } : {}),
  }));
}

export interface ToHarOptions {
  /** Mask sensitive header values (default true). */
  redact?: boolean;
  /** Extra header names (lower-cased) to mask on top of the defaults. */
  redactHeaders?: string[];
  creatorVersion?: string;
}

function headerArray(map: Record<string, string> | undefined, sensitive: Set<string>): HarNameValue[] {
  if (!map) return [];
  return Object.entries(map).map(([name, value]) => ({
    name,
    value: sensitive.has(name.toLowerCase()) ? REDACTED : value,
  }));
}

function queryStringOf(url: string): HarNameValue[] {
  const q = url.indexOf("?");
  if (q < 0) return [];
  return url
    .slice(q + 1)
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      const name = eq < 0 ? pair : pair.slice(0, eq);
      const value = eq < 0 ? "" : pair.slice(eq + 1);
      const dec = (s: string) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      };
      return { name: dec(name), value: dec(value) };
    });
}

/** Derive HAR timings (ms) from a CDP ResourceTiming object; -1 when unknown. */
function timingsOf(t: Record<string, number> | undefined): HarEntry["timings"] {
  const base = { blocked: -1, dns: -1, connect: -1, ssl: -1, send: -1, wait: -1, receive: -1 };
  if (!t) return base;
  const span = (a?: number, b?: number) =>
    typeof a === "number" && typeof b === "number" && b >= a && a >= 0 ? b - a : -1;
  return {
    blocked: -1,
    dns: span(t["dnsStart"], t["dnsEnd"]),
    connect: span(t["connectStart"], t["connectEnd"]),
    ssl: span(t["sslStart"], t["sslEnd"]),
    send: span(t["sendStart"], t["sendEnd"]),
    wait: span(t["sendEnd"], t["receiveHeadersEnd"]),
    receive: 0,
  };
}

function totalTime(tm: HarEntry["timings"]): number {
  return ["dns", "connect", "ssl", "send", "wait", "receive"].reduce((sum, k) => {
    const v = (tm as unknown as Record<string, number>)[k];
    return v > 0 ? sum + v : sum;
  }, 0);
}

/** Convert captured NetworkEntry[] into a valid HAR 1.2 log (redacted by default). */
export function toHar(entries: NetworkEntry[], opts: ToHarOptions = {}): HarLog {
  const redact = opts.redact !== false;
  const sensitive = new Set(redact ? [...DEFAULT_SENSITIVE, ...(opts.redactHeaders ?? []).map((h) => h.toLowerCase())] : []);

  const harEntries: HarEntry[] = entries.map((e) => {
    const timings = timingsOf(e.timing);
    const startedDateTime = new Date((e.wallTime && e.wallTime > 0 ? e.wallTime : 0) * 1000).toISOString();
    const postData =
      e.postData !== undefined
        ? { mimeType: e.requestHeaders?.["Content-Type"] ?? "application/octet-stream", text: redact && e.postData ? REDACTED : e.postData }
        : undefined;
    return {
      startedDateTime,
      time: totalTime(timings),
      request: {
        method: e.method,
        url: e.url,
        httpVersion: "HTTP/1.1",
        headers: headerArray(e.requestHeaders, sensitive),
        queryString: queryStringOf(e.url),
        cookies: [],
        headersSize: -1,
        bodySize: e.postData ? e.postData.length : 0,
        ...(postData ? { postData } : {}),
      },
      response: {
        status: e.status ?? 0,
        statusText: e.statusText ?? "",
        httpVersion: "HTTP/1.1",
        headers: headerArray(e.responseHeaders, sensitive),
        cookies: [],
        content: { size: e.encodedDataLength ?? 0, mimeType: e.mimeType ?? "" },
        redirectURL: "",
        headersSize: -1,
        bodySize: e.encodedDataLength ?? -1,
      },
      cache: {},
      timings,
    };
  });

  return {
    log: {
      version: "1.2",
      creator: { name: "podium-mcp", version: opts.creatorVersion ?? "0.2.0" },
      entries: harEntries,
    },
  };
}

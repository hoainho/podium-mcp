/**
 * Head-to-head MCP comparison: podium vs its three reference servers.
 *
 *   podium     — this repo (dist/index.js)
 *   mobile-mcp — @mobilenext/mobile-mcp (native simctl/idb-style control)
 *   maestro    — maestro mcp --no-viewer (persistent Maestro engine)
 *   rn-debug   — @twodoorsdev/react-native-debugger-mcp (Metro CDP logs)
 *
 * Each server is spawned FRESH over stdio, then timed on equivalent ops
 * against the same booted simulator + foreground app. Taps run twice
 * (cold/warm) to expose per-call engine spin-up vs persistent sessions.
 *
 * Usage: node --experimental-strip-types scripts/compare-mcps.ts <udid> <bundleId>
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const UDID = process.argv[2] ?? "74DD7D29-38BC-4B82-B92A-FFA7E0C15F74";
const BUNDLE = process.argv[3] ?? "com.playstudios.thewinzone";

// ─── Server definitions ──────────────────────────────────────────────────────

interface ServerDef {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

const SERVERS: ServerDef[] = [
  {
    name: "podium",
    command: "node",
    args: [join(repoRoot, "dist", "index.js")],
  },
  {
    name: "mobile-mcp",
    command: "npx",
    args: ["-y", "@mobilenext/mobile-mcp@latest"],
  },
  {
    name: "maestro",
    command: join(process.env.HOME ?? "", ".maestro", "bin", "maestro"),
    args: ["mcp", "--no-viewer"],
    env: {
      JAVA_HOME: "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
    },
  },
  {
    name: "rn-debugger",
    command: "npx",
    args: ["-y", "@twodoorsdev/react-native-debugger-mcp"],
  },
];

// ─── Op mapping per server ───────────────────────────────────────────────────
// Each op resolves to { tool, args } for a given server, or null = unsupported.

type OpSpec = { tool: string; args: Record<string, unknown> } | null;

const OPS: Array<{ op: string; map: (s: string) => OpSpec }> = [
  {
    op: "list_devices",
    map: (s) =>
      s === "podium"
        ? { tool: "device_list", args: {} }
        : s === "mobile-mcp"
          ? { tool: "mobile_list_available_devices", args: {} }
          : s === "maestro"
            ? { tool: "list_devices", args: {} }
            : { tool: "getConnectedApps", args: { metroServerPort: 8081 } },
  },
  {
    op: "screenshot",
    map: (s) =>
      s === "podium"
        ? { tool: "screenshot", args: { udid: UDID } }
        : s === "mobile-mcp"
          ? { tool: "mobile_take_screenshot", args: { device: UDID } }
          : s === "maestro"
            ? { tool: "take_screenshot", args: { device_id: UDID } }
            : null,
  },
  {
    op: "inspect_screen",
    map: (s) =>
      s === "podium"
        ? { tool: "inspect_screen", args: { udid: UDID, compact: true } }
        : s === "mobile-mcp"
          ? { tool: "mobile_list_elements_on_screen", args: { device: UDID } }
          : s === "maestro"
            ? { tool: "inspect_screen", args: { device_id: UDID } }
            : null,
  },
  {
    op: "tap (cold)",
    map: (s) =>
      s === "podium"
        ? { tool: "tap_on", args: { udid: UDID, bundleId: BUNDLE, x: 200, y: 400 } }
        : s === "mobile-mcp"
          ? { tool: "mobile_click_on_screen_at_coordinates", args: { device: UDID, x: 200, y: 400 } }
          : s === "maestro"
            ? { tool: "run", args: { device_id: UDID, yaml: `appId: ${BUNDLE}\n---\n- tapOn:\n    point: "200,400"` } }
            : null,
  },
  {
    op: "tap (warm)",
    map: (s) =>
      s === "podium"
        ? { tool: "tap_on", args: { udid: UDID, bundleId: BUNDLE, x: 200, y: 400 } }
        : s === "mobile-mcp"
          ? { tool: "mobile_click_on_screen_at_coordinates", args: { device: UDID, x: 200, y: 400 } }
          : s === "maestro"
            ? { tool: "run", args: { device_id: UDID, yaml: `appId: ${BUNDLE}\n---\n- tapOn:\n    point: "200,400"` } }
            : null,
  },
  {
    op: "console_logs",
    map: (s) =>
      s === "podium"
        ? { tool: "metro_logs", args: { durationMs: 500 } }
        : null, // rn-debugger handled specially (needs app object from getConnectedApps)
  },
];

// ─── Harness ─────────────────────────────────────────────────────────────────

interface Cell {
  ms: number;
  ok: boolean;
  note: string;
}

interface ServerReport {
  name: string;
  connectMs: number;
  toolCount: number;
  cells: Record<string, Cell>;
  fatal?: string;
}

async function timeCall(
  client: Client,
  tool: string,
  args: Record<string, unknown>,
  timeoutMs = 90_000
): Promise<Cell> {
  const start = Date.now();
  try {
    const res = (await client.callTool({ name: tool, arguments: args }, undefined, {
      timeout: timeoutMs,
    })) as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
    const ms = Date.now() - start;
    const text = (res.content ?? [])
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join(" ")
      .slice(0, 120);
    if (res.isError) {
      // Graceful structured error (e.g. "metro not running") — tool worked
      return { ms, ok: false, note: `err: ${text}` };
    }
    return { ms, ok: true, note: "" };
  } catch (err) {
    return { ms: Date.now() - start, ok: false, note: `threw: ${String(err).slice(0, 100)}` };
  }
}

async function benchServer(def: ServerDef): Promise<ServerReport> {
  const report: ServerReport = { name: def.name, connectMs: 0, toolCount: 0, cells: {} };

  const transport = new StdioClientTransport({
    command: def.command,
    args: def.args,
    env: { ...process.env as Record<string, string>, ...(def.env ?? {}) },
    stderr: "ignore",
  });
  const client = new Client({ name: "podium-compare", version: "1.0.0" });

  const t0 = Date.now();
  try {
    await client.connect(transport);
  } catch (err) {
    report.fatal = `connect failed: ${String(err).slice(0, 150)}`;
    return report;
  }
  report.connectMs = Date.now() - t0;

  try {
    const tools = await client.listTools();
    report.toolCount = tools.tools.length;
  } catch {
    report.toolCount = -1;
  }

  for (const { op, map } of OPS) {
    const spec = map(def.name);
    if (!spec) {
      report.cells[op] = { ms: 0, ok: false, note: "n/a" };
      continue;
    }
    report.cells[op] = await timeCall(client, spec.tool, spec.args);
    console.error(
      `  [${def.name}] ${op} → ${report.cells[op].ok ? "ok" : "ERR"} ${report.cells[op].ms}ms ${report.cells[op].note}`
    );
  }

  // rn-debugger console_logs: needs the app object from getConnectedApps
  if (def.name === "rn-debugger") {
    const start = Date.now();
    try {
      const apps = (await client.callTool({
        name: "getConnectedApps",
        arguments: { metroServerPort: 8081 },
      })) as { content?: Array<{ type: string; text?: string }> };
      const text = (apps.content ?? []).map((c) => c.text ?? "").join("");
      const parsed = JSON.parse(text) as Array<{ id: string; description: string; webSocketDebuggerUrl: string }>;
      if (Array.isArray(parsed) && parsed.length > 0) {
        report.cells["console_logs"] = await timeCall(client, "readConsoleLogsFromApp", {
          app: parsed[0],
          maxLogs: 50,
        });
      } else {
        report.cells["console_logs"] = { ms: Date.now() - start, ok: false, note: "no metro apps" };
      }
    } catch (err) {
      report.cells["console_logs"] = {
        ms: Date.now() - start,
        ok: false,
        note: `err: ${String(err).slice(0, 80)}`,
      };
    }
  }

  await client.close().catch(() => undefined);
  return report;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const reports: ServerReport[] = [];
for (const def of SERVERS) {
  console.error(`\n=== ${def.name} ===`);
  reports.push(await benchServer(def));
}

// Markdown table: rows = ops, columns = servers
const opNames = ["connect", "tool count", ...OPS.map((o) => o.op)];
const header = `| Operation | ${reports.map((r) => r.name).join(" | ")} |`;
const sep = `|---|${reports.map(() => "---").join("|")}|`;
const lines: string[] = [header, sep];

for (const op of opNames) {
  const cells = reports.map((r) => {
    if (r.fatal) return "FATAL";
    if (op === "connect") return `${r.connectMs}ms`;
    if (op === "tool count") return String(r.toolCount);
    const c = r.cells[op];
    if (!c) return "—";
    if (c.note === "n/a") return "n/a";
    return c.ok ? `${c.ms}ms` : `${c.ms}ms ⚠️`;
  });
  lines.push(`| ${op} | ${cells.join(" | ")} |`);
}

const table = lines.join("\n");
console.log("\n" + table + "\n");

const out = { udid: UDID, bundle: BUNDLE, reports };
writeFileSync("/tmp/podium-compare-result.json", JSON.stringify(out, null, 2), "utf8");
console.log("Full JSON: /tmp/podium-compare-result.json");

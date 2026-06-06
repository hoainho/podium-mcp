/**
 * Crash report helpers — reads Apple DiagnosticReports (.ips / .crash files).
 * DiagnosticReports dir is injectable so tests can point at a fixture dir.
 */

import { readdir, stat, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import os from "node:os";

export const DEFAULT_DIAGNOSTICS_DIR = join(
  os.homedir(),
  "Library",
  "Logs",
  "DiagnosticReports"
);

/** Per-simulator DiagnosticReports dir — sim-process crashes can land here instead of the host dir. */
export function simDiagnosticsDir(udid: string): string {
  return join(
    os.homedir(),
    "Library",
    "Developer",
    "CoreSimulator",
    "Devices",
    udid,
    "data",
    "Library",
    "Logs",
    "DiagnosticReports"
  );
}

export interface CrashEntry {
  id: string;
  processName: string;
  date: string;
  sizeBytes: number;
  /** Which DiagnosticReports dir the report came from. */
  source: "host" | "simulator";
}

export interface ListCrashesFilter {
  processName?: string;
  sinceHours?: number;
  /** When given, the simulator's own DiagnosticReports dir is scanned too. */
  udid?: string;
}

/**
 * Scans `dir` for .ips and .crash files, returns entries sorted newest-first.
 * Filtered case-insensitively by processName when provided.
 */
export async function listCrashes(
  filter?: ListCrashesFilter,
  dir = DEFAULT_DIAGNOSTICS_DIR
): Promise<CrashEntry[]> {
  const dirs: Array<{ path: string; source: CrashEntry["source"] }> = [
    { path: dir, source: "host" },
  ];
  if (filter?.udid) {
    dirs.push({ path: simDiagnosticsDir(filter.udid), source: "simulator" });
  }

  const sinceMs = filter?.sinceHours != null
    ? Date.now() - filter.sinceHours * 3600 * 1000
    : null;

  const processNameLower = filter?.processName?.toLowerCase();

  const results: CrashEntry[] = [];

  await Promise.all(
    dirs.map(async ({ path: scanDir, source }) => {
      let entries: string[];
      try {
        entries = await readdir(scanDir);
      } catch {
        return; // dir missing/unreadable — skip this source
      }

      const relevant = entries.filter(
        (f) => f.endsWith(".ips") || f.endsWith(".crash")
      );

      await Promise.all(
        relevant.map(async (filename) => {
          const fullPath = join(scanDir, filename);
          let info: { mtime: Date; size: number };
          try {
            const s = await stat(fullPath);
            info = { mtime: s.mtime, size: s.size };
          } catch {
            return;
          }

          if (sinceMs != null && info.mtime.getTime() < sinceMs) {
            return;
          }

          // Parse processName from filename: typically "<ProcessName>-<date>-<time>.ips"
          const processName = extractProcessName(filename);

          if (processNameLower && !processName.toLowerCase().includes(processNameLower)) {
            return;
          }

          results.push({
            id: filename,
            processName,
            date: info.mtime.toISOString(),
            sizeBytes: info.size,
            source,
          });
        })
      );
    })
  );

  // Sort newest first
  results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return results;
}

/**
 * Extracts a process name from a crash filename.
 * Filenames are typically: "<ProcessName>-<YYYY-MM-DD>-<HHmmss>.<ips|crash>"
 */
function extractProcessName(filename: string): string {
  // Strip extension
  const noExt = filename.replace(/\.(ips|crash)$/, "");
  // The part before the first date-looking segment is the process name
  // Date segments look like "-2024-01-15" or "-20240115"
  const match = noExt.match(/^(.+?)-\d{4}-\d{2}-\d{2}/);
  if (match?.[1]) return match[1];
  // Fallback: everything before the last dash-separated numeric token
  const parts = noExt.split("-");
  const firstNumericIdx = parts.findIndex((p) => /^\d{4,}$/.test(p));
  if (firstNumericIdx > 0) return parts.slice(0, firstNumericIdx).join("-");
  return noExt;
}

// ─── crash_get ────────────────────────────────────────────────────────────────

const BODY_LIMIT = 8000;

export interface CrashReport {
  header: Record<string, unknown>;
  body: string;
  truncated: boolean;
}

export interface CrashGetError {
  error: string;
}

export type CrashGetResult = CrashReport | CrashGetError;

/**
 * Reads a crash report by id (filename only — path-traversal-safe).
 * For .ips files: first line is JSON header, rest is report body.
 * For .crash files: entire content is the body, header is {}.
 */
export async function getCrash(
  id: string,
  dir = DEFAULT_DIAGNOSTICS_DIR,
  udid?: string
): Promise<CrashGetResult> {
  // Path-traversal guard: use basename only, must match original
  const safe = basename(id);
  if (safe !== id || safe.includes("/") || safe.includes("\\")) {
    return { error: `invalid crash id: ${id}` };
  }
  if (!safe.endsWith(".ips") && !safe.endsWith(".crash")) {
    return { error: `invalid crash id: ${id}` };
  }

  // Candidate dirs: host DiagnosticReports, then the sim container when udid given.
  // The id is a bare filename joined onto server-controlled dirs, so reads cannot
  // escape these locations. (Symlinks placed *inside* an OS-managed dir are not
  // resolved — acceptable, as these dirs are not client-writable.)
  const candidates = [dir, ...(udid ? [simDiagnosticsDir(udid)] : [])];

  let content: string | null = null;
  for (const candidate of candidates) {
    try {
      content = await readFile(join(candidate, safe), "utf8");
      break;
    } catch {
      // try next candidate
    }
  }
  if (content === null) {
    return { error: `crash report not found: ${id}` };
  }

  if (safe.endsWith(".ips")) {
    const newlineIdx = content.indexOf("\n");
    const headerLine = newlineIdx >= 0 ? content.slice(0, newlineIdx) : content;
    const bodyFull = newlineIdx >= 0 ? content.slice(newlineIdx + 1) : "";

    let header: Record<string, unknown> = {};
    try {
      header = JSON.parse(headerLine) as Record<string, unknown>;
    } catch {
      // malformed header — return raw
      header = { _raw: headerLine };
    }

    const truncated = bodyFull.length > BODY_LIMIT;
    const body = truncated ? bodyFull.slice(0, BODY_LIMIT) : bodyFull;
    return { header, body, truncated };
  } else {
    // .crash file — plain text
    const truncated = content.length > BODY_LIMIT;
    const body = truncated ? content.slice(0, BODY_LIMIT) : content;
    return { header: {}, body, truncated };
  }
}

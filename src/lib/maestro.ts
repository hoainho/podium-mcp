import { run } from "./exec.js";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";

/** Full path to the maestro binary, or null if not resolvable. */
export async function resolveMaestro(): Promise<string | null> {
  // Fast path: on PATH
  const which = await run("which", ["maestro"]);
  if (which.code === 0 && which.stdout.length > 0) {
    return which.stdout;
  }
  // Known install location
  const known = `${os.homedir()}/.maestro/bin/maestro`;
  const check = await run("test", ["-x", known]);
  if (check.code === 0) {
    return known;
  }
  return null;
}

/** Returns a process env with JAVA_HOME set for the Maestro JVM. */
export function maestroEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    JAVA_HOME:
      process.env.JAVA_HOME ??
      "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
  };
}

// ─── Flow result ─────────────────────────────────────────────────────────────

export interface FlowStep {
  name: string;
  passed: boolean;
}

export interface FlowResult {
  passed: boolean;
  steps: FlowStep[];
  /** Tail-truncated to ~4000 chars for token budget. */
  rawOutput: string;
  durationMs: number;
  retries: number;
}

/**
 * idb-flakiness patterns that warrant a retry. Deliberately narrow:
 * a bare /idb/ would retry on any output merely mentioning idb.
 */
const IDB_FLAKY_RE =
  /Failed to connect to 127\.0\.0\.1|java\.net\.ConnectException|idb_companion/i;

/** Truncate a string to approximately `maxChars` from the tail. */
function tailTruncate(s: string, maxChars = 4000): string {
  if (s.length <= maxChars) return s;
  return `...[truncated]\n${s.slice(s.length - maxChars)}`;
}

/** Best-effort parse of maestro stdout into per-step results. */
function parseSteps(output: string): FlowStep[] {
  const steps: FlowStep[] = [];
  // Maestro emits per-step lines in two formats:
  //   glyph:  ✅ someCommand   /  ❌ someCommand   (✓/✗ alternates)
  //   plain:  Launch app "x"... COMPLETED  /  Assert that "y"... FAILED
  for (const line of output.split("\n")) {
    const passGlyph = /[✅✓✔]/.test(line);
    const failGlyph = /[❌✗✘✕]/.test(line);
    if (passGlyph || failGlyph) {
      const name = line
        .replace(/[✅✓✔❌✗✘✕]/gu, "")
        .replace(/^\s+|\s+$/g, "");
      if (name.length > 0) {
        steps.push({ name, passed: passGlyph && !failGlyph });
      }
      continue;
    }
    const plain = /^(.+?)\.{3}\s*(COMPLETED|FAILED|SKIPPED)\s*$/.exec(line.trim());
    if (plain) {
      steps.push({ name: plain[1].trim(), passed: plain[2] !== "FAILED" });
    }
  }
  return steps;
}

// ─── Flow options ─────────────────────────────────────────────────────────────

export interface RunFlowOpts {
  udid: string;
  /** Inline YAML string — written to a temp file. */
  yaml?: string;
  /** Explicit list of flow file paths. */
  files?: string[];
  /** Directory of flows. */
  dir?: string;
  includeTags?: string[];
  excludeTags?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  /** Backoff delays between idb-flakiness retries. Injectable for tests. */
  retryDelaysMs?: number[];
}

/**
 * Execute a Maestro flow. Enforces exactly-one-of yaml/files/dir.
 * Retries up to 2 times on idb flakiness (2s, 5s backoff).
 */
export async function runMaestroFlow(opts: RunFlowOpts): Promise<FlowResult> {
  const { udid, yaml, files, dir, includeTags, excludeTags, env, timeoutMs } =
    opts;

  // Validate exactly-one-of
  const sourcesProvided = [yaml, files, dir].filter((v) => v !== undefined);
  if (sourcesProvided.length !== 1) {
    throw new Error(
      `runMaestroFlow requires exactly one of yaml, files, or dir — got ${sourcesProvided.length === 0 ? "none" : "multiple"}.`
    );
  }

  const binary = await resolveMaestro();
  if (!binary) {
    throw new Error(
      "maestro binary not found. Install Maestro: https://maestro.mobile.dev"
    );
  }

  const envOverride = { ...maestroEnv(), ...(env ?? {}) };
  const timeout = timeoutMs ?? 120_000;

  let tmpDir: string | null = null;
  let tmpFile: string | null = null;

  try {
    // Build the base arg list
    const baseArgs: string[] = ["--udid", udid, "test"];

    // Resolve target
    let target: string;
    const extraArgs: string[] = [];

    if (yaml !== undefined) {
      // Write inline yaml to a temp file
      tmpDir = await mkdtemp(join(os.tmpdir(), "podium-flow-"));
      tmpFile = join(tmpDir, "flow.yaml");
      await writeFile(tmpFile, yaml, "utf8");
      target = tmpFile;
    } else if (files !== undefined) {
      if (files.length === 0) {
        throw new Error("files array must not be empty.");
      }
      // Pass files as positional args after test
      target = files[0];
      for (const f of files.slice(1)) {
        extraArgs.push(f);
      }
    } else {
      // dir mode
      target = dir!;
      if (includeTags && includeTags.length > 0) {
        extraArgs.push("--include-tags", includeTags.join(","));
      }
      if (excludeTags && excludeTags.length > 0) {
        extraArgs.push("--exclude-tags", excludeTags.join(","));
      }
    }

    const args = [...baseArgs, target, ...extraArgs];

    // Execute with idb-flakiness retry.
    // Success is exit-code-driven: stdout scraping ("Flow completed") could be
    // spoofed by flow content that echoes the same string.
    const RETRY_DELAYS_MS = opts.retryDelaysMs ?? [2000, 5000];
    const startedAt = Date.now();
    let result = await run(binary, args, { timeout, env: envOverride });
    let retries = 0;

    for (const delay of RETRY_DELAYS_MS) {
      if (result.code === 0) break;

      const combined = result.stdout + result.stderr;
      if (IDB_FLAKY_RE.test(combined)) {
        retries++;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        result = await run(binary, args, { timeout, env: envOverride });
      } else {
        break;
      }
    }

    const combined = result.stdout + result.stderr;
    const passed = result.code === 0;

    const steps = parseSteps(combined);
    const rawOutput = tailTruncate(combined);

    return { passed, steps, rawOutput, durationMs: Date.now() - startedAt, retries };
  } finally {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Run `maestro --udid <udid> hierarchy` and return parsed JSON when available,
 * or a structured plain-text result. Never throws.
 */
export async function getHierarchy(
  udid: string
): Promise<
  | { ok: true; json: unknown }
  | { ok: false; text: string }
  | { ok: false; unsupported: true; text: string }
> {
  const binary = await resolveMaestro();
  if (!binary) {
    return {
      ok: false,
      text: "maestro binary not found — cannot retrieve hierarchy.",
    };
  }

  const result = await run(binary, ["--udid", udid, "hierarchy"], {
    timeout: 30_000,
    env: maestroEnv(),
  });

  const combined = result.stdout + result.stderr;

  // Detect version that doesn't support the `hierarchy` sub-command
  if (
    /unknown command|invalid command|No such subcommand|hierarchy.*not.*found/i.test(
      combined
    ) ||
    (result.code !== 0 &&
      /usage:|help:/i.test(combined) &&
      !/[\[{]/.test(result.stdout))
  ) {
    return {
      ok: false,
      unsupported: true,
      text:
        "This Maestro version does not expose a `hierarchy` CLI command. " +
        "Screen inspection requires Maestro Studio's engine (maestro studio). " +
        `Raw output: ${tailTruncate(combined, 1000)}`,
    };
  }

  // Try to find JSON in stdout
  const jsonStart = result.stdout.indexOf("{");
  const jsonStartArr = result.stdout.indexOf("[");
  const firstJson =
    jsonStart === -1
      ? jsonStartArr
      : jsonStartArr === -1
        ? jsonStart
        : Math.min(jsonStart, jsonStartArr);

  if (firstJson !== -1) {
    try {
      const parsed: unknown = JSON.parse(result.stdout.slice(firstJson));
      return { ok: true, json: parsed };
    } catch {
      // fall through to raw text
    }
  }

  if (result.code !== 0) {
    return {
      ok: false,
      text: `hierarchy command failed (exit ${result.code}): ${tailTruncate(combined, 1000)}`,
    };
  }

  return { ok: false, text: tailTruncate(combined, 4000) };
}

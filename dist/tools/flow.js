import { z } from "zod";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { runMaestroFlow } from "../lib/maestro.js";
import { errorResult, okResult } from "../lib/result.js";
/**
 * Resolves the package root from anywhere under dist/ or src/.
 * import.meta.url when compiled: file:///…/dist/tools/flow.js  → go up 2 dirs.
 * import.meta.url when in ts-node / vitest src: file:///…/src/tools/flow.ts → go up 2 dirs.
 * Both are 2 levels deep from the package root.
 */
function packageRoot() {
    const thisFile = fileURLToPath(import.meta.url);
    // dist/tools/flow.js  → dirname x2 = dist → package root
    // src/tools/flow.ts   → dirname x2 = src  → package root
    return dirname(dirname(dirname(thisFile)));
}
export function registerFlowTools(server) {
    // ─── run_flow ─────────────────────────────────────────────────────────────────
    server.tool("run_flow", "Execute one or more Maestro flows on a device. Provide exactly one of: " +
        "yaml (inline YAML string), files (array of flow file paths), or dir (directory path). " +
        "includeTags and excludeTags are only applicable when using dir.", {
        udid: z.string().describe("Simulator / device UDID (from device_list)"),
        yaml: z
            .string()
            .optional()
            .describe("Inline Maestro YAML flow string (preferred for exploration)"),
        files: z
            .array(z.string())
            .optional()
            .describe("Array of .yaml flow file paths"),
        dir: z
            .string()
            .optional()
            .describe("Directory containing .yaml flow files"),
        includeTags: z
            .array(z.string())
            .optional()
            .describe("Only run flows tagged with these tags (dir mode only)"),
        excludeTags: z
            .array(z.string())
            .optional()
            .describe("Exclude flows tagged with these tags (dir mode only)"),
        env: z
            .record(z.string())
            .optional()
            .describe("Environment variables passed to the flow"),
        timeoutMs: z
            .number()
            .int()
            .optional()
            .describe("Flow timeout in milliseconds (default 120 000)"),
    }, async ({ udid, yaml, files, dir, includeTags, excludeTags, env, timeoutMs }) => {
        // Validate exactly-one-of BEFORE executing
        const sourcesProvided = [yaml, files, dir].filter((v) => v !== undefined);
        if (sourcesProvided.length === 0) {
            return errorResult("run_flow requires exactly one of: yaml, files, or dir — none provided.");
        }
        if (sourcesProvided.length > 1) {
            return errorResult("run_flow requires exactly one of: yaml, files, or dir — multiple provided. " +
                "Pass only one source at a time.");
        }
        try {
            const result = await runMaestroFlow({
                udid,
                yaml,
                files,
                dir,
                includeTags,
                excludeTags,
                env,
                timeoutMs,
            });
            if (!result.passed) {
                return errorResult(`Flow did not pass (retries: ${result.retries}):\n${result.rawOutput}`);
            }
            return okResult({
                ok: true,
                passed: result.passed,
                steps: result.steps,
                retries: result.retries,
                durationMs: result.durationMs,
                rawOutput: result.rawOutput,
            });
        }
        catch (err) {
            return errorResult(`run_flow failed: ${String(err)}`);
        }
    });
    // ─── cheat_sheet ──────────────────────────────────────────────────────────────
    server.tool("cheat_sheet", "Returns the bundled Maestro flow script cheat sheet (offline copy). " +
        "Consult this before authoring unfamiliar Maestro commands, required args, " +
        "nested properties, conditionals, or multi-screen flows.", {}, async () => {
        try {
            const root = packageRoot();
            const assetPath = join(root, "assets", "maestro-cheat-sheet.yaml");
            const content = await readFile(assetPath, "utf8");
            return { content: [{ type: "text", text: content }] };
        }
        catch (err) {
            return errorResult(`cheat_sheet: could not read asset: ${String(err)}`);
        }
    });
}

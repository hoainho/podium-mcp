import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, constants } from "node:fs/promises";
import { resolve } from "node:path";
import os from "node:os";
const execFileAsync = promisify(execFile);
/**
 * Run a command with args. Never throws — errors are captured in the result.
 * Uses execFile (no shell) so arguments are passed verbatim — immune to
 * shell metacharacter injection from udids, paths, selectors, or yaml content.
 */
export async function run(cmd, args, opts) {
    try {
        const { stdout, stderr } = await execFileAsync(cmd, args, {
            timeout: opts?.timeout ?? 5000,
            cwd: opts?.cwd,
            env: opts?.env,
            maxBuffer: 16 * 1024 * 1024,
        });
        return { code: 0, stdout: stdout.trim(), stderr: stderr.trim(), timedOut: false };
    }
    catch (err) {
        const e = err;
        // execFile kills the child with SIGTERM when the timeout fires (code is then
        // null/non-numeric). Distinguish that from a maxBuffer overrun, which also
        // kills the child but carries the ERR_CHILD_PROCESS_STDIO_MAXBUFFER code.
        const timedOut = e.killed === true &&
            e.signal === "SIGTERM" &&
            e.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        return {
            code: typeof e.code === "number" ? e.code : 1,
            stdout: (e.stdout ?? "").trim(),
            stderr: (e.stderr ?? "").trim(),
            timedOut,
        };
    }
}
/**
 * Known extra PATH locations to probe when `which` finds nothing.
 * Derived from the current user's home (portable across machines / CI) plus
 * the standard Homebrew prefixes. Add to this list when integrating new tools.
 */
const EXTRA_PATHS = [
    resolve(os.homedir(), ".maestro", "bin"),
    resolve(os.homedir(), ".local", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
];
/**
 * Returns true if `cmd` resolves on PATH or in any EXTRA_PATHS entry.
 * Never throws.
 */
export async function commandExists(cmd) {
    try {
        // Fast-path: ask the shell
        const result = await run("which", [cmd]);
        if (result.code === 0 && result.stdout.length > 0) {
            return true;
        }
        // Fallback: probe well-known extra dirs
        for (const dir of EXTRA_PATHS) {
            try {
                await access(resolve(dir, cmd), constants.X_OK);
                return true;
            }
            catch {
                // not found here — keep trying
            }
        }
        return false;
    }
    catch {
        return false;
    }
}

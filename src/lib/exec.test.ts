import { describe, it, expect } from "vitest";
import { access } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";
import { run } from "./exec.js";

// Regression for the architect-flagged command-injection finding:
// run() must pass args verbatim to the binary (execFile, no shell), so
// shell metacharacters in tainted params (udid/bundleId/path/...) are inert.
describe("run — no shell interpretation", () => {
  it("does not execute $() or backtick substitution embedded in args", async () => {
    const marker = join(os.tmpdir(), `podium-inject-${process.pid}-${Date.now()}`);

    const dollar = await run("echo", [`$(touch ${marker})`]);
    const backtick = await run("echo", [`\`touch ${marker}\``]);

    // echo succeeds and prints the literal strings — no command ran
    expect(dollar.code).toBe(0);
    expect(dollar.stdout).toContain("$(touch");
    expect(backtick.code).toBe(0);
    expect(backtick.stdout).toContain("`touch");

    // The marker file must NOT have been created by either call
    await expect(access(marker)).rejects.toThrow();
  });

  it("treats pipes and redirects as literal arg text", async () => {
    const result = await run("echo", ["a", "|", "cat", ">", "/tmp/podium-pipe"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("a | cat > /tmp/podium-pipe");
  });
});

// Regression for R2: a command that exceeds its timeout must surface a non-zero
// code AND timedOut:true so callers can tell "timed out, retry longer" apart
// from a genuine command failure.
describe("run — timeout handling", () => {
  it("returns code!=0 and timedOut:true when the command exceeds its timeout", async () => {
    const result = await run("sleep", ["2"], { timeout: 100 });
    expect(result.code).not.toBe(0);
    expect(result.timedOut).toBe(true);
  });

  it("returns timedOut:false on a normal fast command", async () => {
    const result = await run("echo", ["hi"], { timeout: 5000 });
    expect(result.code).toBe(0);
    expect(result.timedOut).toBe(false);
  });
});

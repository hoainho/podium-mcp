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

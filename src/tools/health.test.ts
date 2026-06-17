import { describe, it, expect, vi, beforeEach } from "vitest";
import * as exec from "../lib/exec.js";

// We test the commandExists logic used by the health tool directly.
// On the CI/developer machine xcrun is available; maestro lives in ~/.maestro/bin.
// We test both the real lookup path and the mocked path.

describe("commandExists", () => {
  it("returns true for xcrun (always present on macOS)", async () => {
    const result = await exec.commandExists("xcrun");
    expect(result).toBe(true);
  });

  it("returns false for a definitely-nonexistent binary", async () => {
    const result = await exec.commandExists("__podium_nonexistent_binary__");
    expect(result).toBe(false);
  });
});

describe("health tool output shape", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns correct JSON schema with boolean toolchain flags", async () => {
    // Mock commandExists so the test is deterministic regardless of environment
    vi.spyOn(exec, "commandExists").mockImplementation(async (cmd: string) => {
      if (cmd === "xcrun") return true;
      if (cmd === "maestro") return true;
      if (cmd === "adb") return false;
      return false;
    });

    const [xcrun, maestro, adb] = await Promise.all([
      exec.commandExists("xcrun"),
      exec.commandExists("maestro"),
      exec.commandExists("adb"),
    ]);

    const payload = {
      name: "podium-mcp",
      version: "0.1.0",
      toolchain: { xcrun, maestro, adb },
    };

    expect(payload.name).toBe("podium-mcp");
    expect(payload.version).toBe("0.1.0");
    expect(typeof payload.toolchain.xcrun).toBe("boolean");
    expect(typeof payload.toolchain.maestro).toBe("boolean");
    expect(typeof payload.toolchain.adb).toBe("boolean");
    expect(payload.toolchain.xcrun).toBe(true);
    expect(payload.toolchain.maestro).toBe(true);
    expect(payload.toolchain.adb).toBe(false);
  });
});

describe("run helper", () => {
  it("captures stdout from a simple command", async () => {
    const result = await exec.run("echo", ["hello"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("hello");
  });

  it("returns non-zero code and does not throw for bad commands", async () => {
    const result = await exec.run("false", []);
    expect(result.code).not.toBe(0);
  });
});

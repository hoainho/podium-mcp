import { describe, it, expect, vi, afterEach } from "vitest";
import * as exec from "./exec.js";
import { parseUiautomatorXml, makeAdbBackend } from "./adb-backend.js";
import { elementCenter, findElements } from "./native.js";
const DUMP = `<?xml version='1.0' encoding='UTF-8'?><hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" content-desc="" bounds="[0,0][1080,2400]">
<node index="0" text="Sign In" resource-id="com.app:id/signin_btn" class="android.widget.Button" content-desc="" bounds="[100,200][980,320]" />
<node index="1" text="" content-desc="Profile" resource-id="com.app:id/profile" class="android.widget.ImageView" bounds="[900,40][1040,180]" />
<node index="2" text="" content-desc="" resource-id="" class="android.view.View" bounds="[0,0][10,10]" />
</node></hierarchy>`;
describe("parseUiautomatorXml", () => {
    it("keeps addressable nodes (text/desc/id) with frames; skips signal-less nodes", () => {
        const els = parseUiautomatorXml(DUMP);
        expect(els).toHaveLength(2); // FrameLayout root + empty View skipped
        const signin = els.find((e) => e.identifier === "com.app:id/signin_btn");
        expect(signin.label).toBe("Sign In");
        expect(signin.type).toBe("android.widget.Button");
        expect(signin.frame).toEqual({ x: 100, y: 200, width: 880, height: 120 });
        const profile = els.find((e) => e.identifier === "com.app:id/profile");
        expect(profile.label).toBe("Profile"); // content-desc fallback when text is empty
    });
    it("frames drive elementCenter and findElements identically to the iOS path", () => {
        const els = parseUiautomatorXml(DUMP);
        const [signin] = findElements(els, { text: "Sign In" });
        expect(elementCenter(signin)).toEqual({ x: 540, y: 260 });
    });
});
describe("makeAdbBackend", () => {
    afterEach(() => vi.restoreAllMocks());
    const be = makeAdbBackend();
    it("declares name adb", () => {
        expect(be.name).toBe("adb");
    });
    it("tap issues `input tap` with rounded pixels", async () => {
        const spy = vi.spyOn(exec, "run").mockResolvedValue({ code: 0, stdout: "", stderr: "" });
        await be.tap("emulator-5554", 100.6, 200.2);
        expect(spy).toHaveBeenCalledWith("adb", ["-s", "emulator-5554", "shell", "input", "tap", "101", "200"], expect.anything());
    });
    it("swipe appends a duration when provided", async () => {
        const spy = vi.spyOn(exec, "run").mockResolvedValue({ code: 0, stdout: "", stderr: "" });
        await be.swipe("S", 0, 0, 100, 200, 300);
        expect(spy).toHaveBeenCalledWith("adb", ["-s", "S", "shell", "input", "swipe", "0", "0", "100", "200", "300"], expect.anything());
    });
    it("inputText encodes spaces as %s", async () => {
        const spy = vi.spyOn(exec, "run").mockResolvedValue({ code: 0, stdout: "", stderr: "" });
        await be.inputText("S", "hello world");
        expect(spy).toHaveBeenCalledWith("adb", ["-s", "S", "shell", "input", "text", "hello%sworld"], expect.anything());
    });
    it("maps known keys to KEYCODEs and returns null for unknown", async () => {
        expect(be.canPressKey("back")).toBe(true);
        expect(be.canPressKey("nonsense")).toBe(false);
        expect(await be.pressKey("S", "nonsense")).toBeNull();
        const spy = vi.spyOn(exec, "run").mockResolvedValue({ code: 0, stdout: "", stderr: "" });
        await be.pressKey("S", "Back");
        expect(spy).toHaveBeenCalledWith("adb", ["-s", "S", "shell", "input", "keyevent", "KEYCODE_BACK"], expect.anything());
    });
    it("describeAll dumps → cats → parses the hierarchy", async () => {
        vi.spyOn(exec, "run").mockImplementation(async (_cmd, args) => args.includes("cat")
            ? { code: 0, stdout: DUMP, stderr: "" }
            : { code: 0, stdout: "", stderr: "" });
        const els = await be.describeAll("S");
        expect(els).not.toBeNull();
        expect(els).toHaveLength(2);
    });
    it("describeAll returns null when the dump fails", async () => {
        vi.spyOn(exec, "run").mockResolvedValue({ code: 1, stdout: "", stderr: "err" });
        expect(await be.describeAll("S")).toBeNull();
    });
    it("screenPoints reads `wm size`", async () => {
        vi.spyOn(exec, "run").mockResolvedValue({ code: 0, stdout: "Physical size: 1080x2400", stderr: "" });
        expect(await be.screenPoints("S")).toEqual({ w: 1080, h: 2400 });
    });
});

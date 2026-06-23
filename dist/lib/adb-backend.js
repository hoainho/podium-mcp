/**
 * Android gesture/inspection NativeBackend via `adb` (v0.3.0 story A2).
 *
 * Implements the same NativeBackend contract as the idb/mobilecli backends, so
 * tap_on/swipe/input_text/inspect_screen work on Android with no changes at the
 * tool layer. Inspection uses `uiautomator dump` (the device's accessibility/
 * view hierarchy) → XML → NativeElement[], which is token-cheap and DOM-like
 * (resource-id / text / content-desc / bounds) — never a screenshot.
 *
 * `NativeBackend`/`NativeElement` are imported type-only to avoid a runtime
 * import cycle with native.ts (which imports makeAdbBackend at value level).
 */
import { run } from "./exec.js";
import { parseWmSize } from "./adb.js";
const ADB = "adb";
/** Common keys → Android KEYCODEs (no side effects beyond the key press). */
const KEY_MAP = {
    enter: "KEYCODE_ENTER",
    back: "KEYCODE_BACK",
    home: "KEYCODE_HOME",
    tab: "KEYCODE_TAB",
    delete: "KEYCODE_DEL",
    backspace: "KEYCODE_DEL",
    menu: "KEYCODE_MENU",
    "volume up": "KEYCODE_VOLUME_UP",
    "volume down": "KEYCODE_VOLUME_DOWN",
    power: "KEYCODE_POWER",
    search: "KEYCODE_SEARCH",
};
function normalizeKey(key) {
    return KEY_MAP[key.trim().toLowerCase()] ?? null;
}
const BOUNDS_RE = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/;
/**
 * Parse a `uiautomator dump` window XML into NativeElements. Pure; exported for
 * tests. Only nodes carrying an addressable signal (text, content-desc, or
 * resource-id) are kept; `bounds="[x1,y1][x2,y2]"` → frame {x,y,width,height}
 * so elementCenter()/findElements() work identically to the iOS path.
 */
export function parseUiautomatorXml(xml) {
    const els = [];
    const nodeRe = /<node\b([^>]*?)\/?>/g;
    let m;
    while ((m = nodeRe.exec(xml)) !== null) {
        const attrs = m[1];
        const attr = (name) => {
            const a = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
            return a ? a[1] : "";
        };
        const text = attr("text");
        const desc = attr("content-desc");
        const resId = attr("resource-id");
        const cls = attr("class");
        const label = text || desc;
        if (!label && !resId)
            continue;
        const el = { label };
        if (resId)
            el.identifier = resId;
        if (cls)
            el.type = cls;
        const b = BOUNDS_RE.exec(attr("bounds"));
        if (b) {
            const x1 = +b[1];
            const y1 = +b[2];
            const x2 = +b[3];
            const y2 = +b[4];
            el.frame = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
        }
        els.push(el);
    }
    return els;
}
/** `adb shell input text` is space-delimited and treats %s as a space. */
function escapeInputText(text) {
    return text.replace(/ /g, "%s");
}
const px = (n) => String(Math.round(n));
export function makeAdbBackend() {
    return {
        name: "adb",
        tap: (serial, x, y) => run(ADB, ["-s", serial, "shell", "input", "tap", px(x), px(y)], { timeout: 15_000 }),
        swipe: (serial, x1, y1, x2, y2, durationMs) => {
            const args = ["-s", serial, "shell", "input", "swipe", px(x1), px(y1), px(x2), px(y2)];
            if (durationMs && durationMs > 0)
                args.push(px(durationMs));
            return run(ADB, args, { timeout: 15_000 });
        },
        inputText: (serial, text) => run(ADB, ["-s", serial, "shell", "input", "text", escapeInputText(text)], { timeout: 15_000 }),
        canPressKey: (key) => normalizeKey(key) !== null,
        pressKey: async (serial, key) => {
            const code = normalizeKey(key);
            if (!code)
                return null;
            return run(ADB, ["-s", serial, "shell", "input", "keyevent", code], { timeout: 15_000 });
        },
        describeAll: async (serial) => {
            const devicePath = "/sdcard/window_dump.xml";
            const dump = await run(ADB, ["-s", serial, "shell", "uiautomator", "dump", devicePath], {
                timeout: 20_000,
            });
            if (dump.code !== 0)
                return null;
            const cat = await run(ADB, ["-s", serial, "shell", "cat", devicePath], { timeout: 15_000 });
            if (cat.code !== 0)
                return null;
            return parseUiautomatorXml(cat.stdout);
        },
        screenPoints: async (serial) => {
            const r = await run(ADB, ["-s", serial, "shell", "wm", "size"], { timeout: 15_000 });
            if (r.code !== 0)
                return null;
            const s = parseWmSize(r.stdout);
            return s ? { w: s.widthPx, h: s.heightPx } : null;
        },
        setOrientation: async () => null, // Android orientation falls back to Maestro
    };
}

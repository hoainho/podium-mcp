import { describe, it, expect } from "vitest";
import { stepsToMaestro } from "./export-maestro.js";
describe("stepsToMaestro", () => {
    it("transpiles selector-based steps cleanly with no warnings", () => {
        const steps = [
            { action: "tapText", id: "login_btn" },
            { action: "key", key: "enter" },
            { action: "swipe", direction: "up" },
            { action: "waitFor", text: "Home", timeoutMs: 5000 },
            { action: "assertVisible", text: "Welcome" },
        ];
        const { yaml, warnings } = stepsToMaestro("com.example.app", steps);
        expect(warnings).toHaveLength(0);
        expect(yaml).toContain("appId: com.example.app");
        expect(yaml).toContain("- tapOn:\n    id: \"login_btn\"");
        expect(yaml).toContain('- pressKey: "Enter"');
        expect(yaml).toContain("direction: UP");
        expect(yaml).toContain("extendedWaitUntil:");
        expect(yaml).toContain('- assertVisible: "Welcome"');
        expect(yaml).not.toContain("TODO");
    });
    it("emits TODO + warning for a coordinate tap (never silent)", () => {
        const { yaml, warnings } = stepsToMaestro("com.x", [{ action: "tap", x: 100, y: 200 }]);
        expect(yaml).toMatch(/# TODO\[unstable\]: coordinate tap \(100,200\)/);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(/coordinate/);
        expect(yaml).not.toMatch(/^- tapOn:\n {4}point/m); // no active divergent tapOn
    });
    it("emits TODO + warning for focused-field type", () => {
        const { yaml, warnings } = stepsToMaestro("com.x", [{ action: "type", text: "hello", submit: true }]);
        expect(yaml).toMatch(/# TODO\[unstable\]: type "hello"/);
        expect(warnings.some((w) => /focused-field/.test(w))).toBe(true);
    });
    it("emits TODO + warning for regex tapText, but plain text is clean", () => {
        const rgx = stepsToMaestro("com.x", [{ action: "tapText", text: "Log.*In" }]);
        expect(rgx.yaml).toMatch(/# TODO\[unstable\]: tapText regex/);
        expect(rgx.warnings).toHaveLength(1);
        const plain = stepsToMaestro("com.x", [{ action: "tapText", text: "Log In" }]);
        expect(plain.warnings).toHaveLength(0);
        expect(plain.yaml).toContain('- tapOn: "Log In"');
    });
});

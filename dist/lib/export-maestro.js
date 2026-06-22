const REGEX_META = /[.*+?^${}()|[\]\\]/;
function cap(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
export function stepsToMaestro(bundleId, steps) {
    const warnings = [];
    const lines = [`appId: ${bundleId}`, `---`, `- launchApp:`, `    stopApp: false`];
    for (const s of steps) {
        switch (s.action) {
            case "tap":
                lines.push(`# TODO[unstable]: coordinate tap (${s.x},${s.y}) — non-portable; add a testID and use tapText`);
                warnings.push(`tap (${s.x},${s.y}) not exported: raw coordinates aren't portable across layouts/devices`);
                break;
            case "tapText":
                if (s.id) {
                    lines.push(`- tapOn:\n    id: ${JSON.stringify(s.id)}${s.index !== undefined ? `\n    index: ${s.index}` : ""}`);
                }
                else if (s.text && REGEX_META.test(s.text)) {
                    lines.push(`# TODO[unstable]: tapText regex ${JSON.stringify(s.text)} — Maestro matcher semantics differ`);
                    warnings.push(`tapText regex ${JSON.stringify(s.text)} not exported: regex matcher drift between podium and Maestro`);
                }
                else if (s.text) {
                    lines.push(`- tapOn: ${JSON.stringify(s.text)}${s.index !== undefined ? `   # index ${s.index}` : ""}`);
                }
                break;
            case "type":
                lines.push(`# TODO[unstable]: type ${JSON.stringify(s.text)} into the focused field — Maestro inputText targets focus differently (onChange may not fire); tapOn the field first`);
                if (s.submit)
                    lines.push(`#   then: - pressKey: "Enter"`);
                warnings.push(`type "${s.text}" emitted as TODO: focused-field typing isn't faithfully portable to Maestro`);
                break;
            case "key":
                lines.push(`- pressKey: ${JSON.stringify(cap(s.key))}`);
                break;
            case "swipe":
                if (s.startX !== undefined || s.endX !== undefined) {
                    lines.push(`# TODO[unstable]: coordinate swipe — non-portable; use a direction swipe`);
                    warnings.push(`coordinate swipe not exported: raw coordinates aren't portable`);
                }
                else {
                    lines.push(`- swipe:\n    direction: ${(s.direction ?? "up").toUpperCase()}`);
                }
                break;
            case "waitFor":
                lines.push(`- extendedWaitUntil:\n    visible: ${JSON.stringify(s.text)}\n    timeout: ${s.timeoutMs ?? 10000}`);
                break;
            case "assertVisible":
                lines.push(`- assertVisible: ${JSON.stringify(s.text)}`);
                break;
            case "waitMs":
                lines.push(`# wait ${s.ms}ms — no direct Maestro equivalent; prefer extendedWaitUntil on a real condition`);
                break;
            case "screenshot":
                lines.push(`- takeScreenshot: ${JSON.stringify((s.saveTo ?? "screenshot").replace(/\.(png|jpg)$/i, ""))}`);
                break;
        }
    }
    return { yaml: lines.join("\n") + "\n", warnings };
}

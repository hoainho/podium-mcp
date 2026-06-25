---
description: "Drive a canvas/WebGL UI (Pixi/Konva/Fabric/Phaser/Three/Babylon) like native — inspect objects, resolve a fuzzy intent, and tap it, with NO vision. Usage: /podium-mcp:canvas <UDID> <intent or 'list'>"
---

Using podium, act on the canvas/WebGL UI of the WebView app on simulator/device `$ARGUMENTS` (format: `<UDID> <intent>`, e.g. `<UDID> close the popup`). Parse the first whitespace token as the UDID; everything after it is the INTENT.

No screenshots, no vision — drive the live scene graph as DOM-like elements.

1. `canvas_inspect` with the UDID — confirm a framework was detected and list the addressable objects. If `framework` is `unknown` or `count` is 0, report the returned `hint` (expose the framework root on `window`, or fall back to a screenshot + `tap_with_fallback`) and stop.
2. If the intent is `list` or empty, present the objects as a markdown table (name / text / type / x,y) and stop.
3. `canvas_resolve` with the UDID and the intent — show the ranked candidates with their `reasons` and the `confidentEnough` flag.
   - If `confidentEnough` is **false**, do NOT tap. Present the top candidates and ask the user which one (fail-closed by design — two equally-good targets must not be blind-tapped).
4. If `confidentEnough` is **true**, call `canvas_tap` with the UDID and the intent — then report what was tapped (name/text), the screen coordinates, and the backend used.
5. Summarize: framework detected, target chosen + the evidence behind it, and the tap result.

Notes:
- Requires an inspectable WKWebView (isInspectable=true; debug/staging builds).
- Canvas tools NEVER use vision; vision is a separate opt-in path (`PODIUM_ALLOW_VISION=1`).
- Honors `PODIUM_DISABLE_WEBVIEW_EVAL=1` (the tools refuse to inject the bridge).

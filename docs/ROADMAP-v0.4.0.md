# podium-mcp v0.4.0 — Canvas Brain + Token Report

Goal: make canvas/WebGL/GL UIs as addressable as DOM/native elements, **without
vision** (the token-frugal path), and **prove** the token savings.

## What shipped

### Canvas Brain (no-vision)
- **`src/lib/canvas-adapters.ts`** — `buildCanvasBridgeScript()` injects an
  in-page IIFE that installs `window.__podiumCanvas` and auto-detects the scene
  graph of **Pixi / Konva / Fabric / Phaser / Three.js / Babylon.js**, reporting
  each node's tap-ready CSS-px geometry (DPR-correct; 3D via camera projection).
  `parseCanvasObjects()` is the TS-side normalizer (mirrors `parseEngineObjects`).
- **`src/lib/canvas-resolver.ts`** — the "close brain": `resolveIntent()` scores
  objects against a fuzzy intent (text/name/role/synonym + a top-right corner
  prior for close-like intents), returns ranked candidates with `reasons[]`, and
  is **fail-closed** (`confidentEnough` requires both an absolute threshold and a
  margin over the runner-up, so ties are never blind-tapped).
- **`src/tools/canvas.ts`** — `canvas_inspect` / `canvas_resolve` / `canvas_tap`.
  Coordinates map the same way `webview_inspect` does: WebView on-screen bounds +
  canvas element viewport offset + object center → absolute logical-point tap.
- **`skills/canvas/SKILL.md`** — `/podium-mcp:canvas <UDID> <intent>` agent.

### Honest coverage layer
- **`src/lib/canvas-a11y.ts`** — opportunistic, FREE: reads a Flutter
  `flt-semantics` / ARIA fallback tree when the app exposes one.
- **`src/lib/canvas-vision.ts`** — opt-in, token-budgeted LAST resort
  (`PODIUM_ALLOW_VISION=1`); off by default, fail-closed, never auto-spends image
  tokens.

### Token report
- **`src/lib/token-report.ts`** + **`scripts/token-bench.mjs`** +
  **`docs/token-economics.md`** + **`podium_token_report`** tool — no-vision vs
  screenshot/vision-loop input tokens, savings ratio, and the fixed per-request
  tool-definition overhead. Heuristic estimators; swap in Anthropic
  `count_tokens` for exact figures.

## The honest boundary
Pixels carry no semantics. Every reference framework (Poco, AltTester,
GameDriver; and all web scene-graph libs) needs the app to cooperate — expose
its scene-graph root (most do, or one line: `window.app = …`). For a fully
opaque, non-cooperating canvas, the no-vision path fails closed and the only
fallback is opt-in vision. v0.4.0 maximizes the no-vision reach (adapters +
resolver) and is honest about the rest.

## Deferred to v0.5.0
Poco/Cocos/Egret + GameDriver/Unreal instrumentation breadth; a bundled
vision/OCR/object-detection backend; more framework adapters.

## Verification
- Unit/integration: **359 tests across 31 files** (adapters, resolver, a11y,
  vision gating, token math, canvas tools with mocked eval/tap). CI on
  `macos-latest`.
- Live e2e (hardware/sample-gated): real Pixi/Konva/Three sample pages — the
  in-page bridge can't execute in a headless unit run.

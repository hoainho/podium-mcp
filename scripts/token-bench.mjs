#!/usr/bin/env node
/**
 * token-bench.mjs — reproducible token-cost benchmark for Podium v0.4.0.
 *
 * Compares two equivalent 8-step mobile automation flows:
 *   (a) Podium no-vision: structured element-list text per step
 *   (b) Screenshot/vision loop: one full-screen image + minimal prompt per step
 *
 * The estimators are inlined from src/lib/token-report.ts (mirror — same
 * formulas) so this script runs with plain `node scripts/token-bench.mjs`
 * without a build step.
 *
 * Usage:
 *   node scripts/token-bench.mjs
 */

// ---------------------------------------------------------------------------
// Estimators — mirror of src/lib/token-report.ts (same formulas, no imports)
// ---------------------------------------------------------------------------

/** @param {string} text @returns {number} */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

const IMAGE_PIXELS_PER_TOKEN = 750;
const IMAGE_TOKEN_MAX = 2_048;

/** @param {number} width @param {number} height @returns {number} */
function estimateImageTokens(width, height) {
  const raw = Math.ceil((width * height) / IMAGE_PIXELS_PER_TOKEN);
  return Math.min(raw, IMAGE_TOKEN_MAX);
}

// ---------------------------------------------------------------------------
// Representative 8-step mobile flow definitions
// ---------------------------------------------------------------------------

// iPhone 14 Pro screenshot resolution
const SCREEN_W = 1170;
const SCREEN_H = 2532;

/**
 * Each step is named for clarity in the output table.
 * noVision steps carry the structured element-list Podium returns from
 * the game engine (AltTester-style).  The vision loop steps carry the
 * screenshot that a pure vision agent would send to the model.
 */
const STEPS = [
  "LaunchApp",
  "DismissSplash",
  "TapPlayButton",
  "SelectLevel",
  "ConfirmStart",
  "TapPause",
  "TapResume",
  "VerifyScore",
];

/**
 * Realistic structured element list for a single screen.
 * ~20 elements, each carrying name / id / x / y / enabled / type.
 * This is what Podium sends to the model instead of a screenshot.
 */
function makeStructuredStep(stepName) {
  const elements = [
    { name: "PlayButton",       id: 1,  x: 540, y: 1200, enabled: true,  type: "Button"  },
    { name: "PauseButton",      id: 2,  x: 1050,y: 120,  enabled: false, type: "Button"  },
    { name: "ScoreLabel",       id: 3,  x: 100, y: 50,   enabled: true,  type: "Text"    },
    { name: "LevelLabel",       id: 4,  x: 540, y: 80,   enabled: true,  type: "Text"    },
    { name: "HealthBar",        id: 5,  x: 100, y: 140,  enabled: true,  type: "Slider"  },
    { name: "EnergyBar",        id: 6,  x: 100, y: 180,  enabled: true,  type: "Slider"  },
    { name: "MapIcon",          id: 7,  x: 60,  y: 1200, enabled: true,  type: "Button"  },
    { name: "SettingsIcon",     id: 8,  x: 1110,y: 60,   enabled: true,  type: "Button"  },
    { name: "QuestBanner",      id: 9,  x: 540, y: 300,  enabled: true,  type: "Image"   },
    { name: "DailyRewardBtn",   id: 10, x: 540, y: 400,  enabled: true,  type: "Button"  },
    { name: "LeaderboardBtn",   id: 11, x: 180, y: 1400, enabled: true,  type: "Button"  },
    { name: "ShopBtn",          id: 12, x: 540, y: 1400, enabled: true,  type: "Button"  },
    { name: "FriendsBtn",       id: 13, x: 900, y: 1400, enabled: true,  type: "Button"  },
    { name: "NewsTab",          id: 14, x: 540, y: 500,  enabled: false, type: "Tab"     },
    { name: "EventsTab",        id: 15, x: 900, y: 500,  enabled: true,  type: "Tab"     },
    { name: "SplashPanel",      id: 16, x: 540, y: 900,  enabled: false, type: "Panel"   },
    { name: "TutorialOverlay",  id: 17, x: 540, y: 900,  enabled: false, type: "Panel"   },
    { name: "ConfirmButton",    id: 18, x: 540, y: 1600, enabled: true,  type: "Button"  },
    { name: "CancelButton",     id: 19, x: 200, y: 1600, enabled: true,  type: "Button"  },
    { name: "CloseButton",      id: 20, x: 1050,y: 300,  enabled: true,  type: "Button"  },
  ];
  return `step:${stepName}\n` + JSON.stringify(elements);
}

// ---------------------------------------------------------------------------
// Build the two flows
// ---------------------------------------------------------------------------

/** @type {{ name: string; kind: "text"; text: string }[]} */
const noVisionFlow = STEPS.map((name) => ({
  name,
  kind: "text",
  text: makeStructuredStep(name),
}));

/** @type {{ name: string; kind: "image"; width: number; height: number; promptText: string }[]} */
const visionFlow = STEPS.map((name) => ({
  name,
  kind: "image",
  width: SCREEN_W,
  height: SCREEN_H,
  // Small steering prompt the vision agent sends alongside each screenshot
  promptText: `Describe what you see and identify the element to interact with for step: ${name}.`,
}));

// ---------------------------------------------------------------------------
// Compute totals
// ---------------------------------------------------------------------------

const noVisionBreakdown = noVisionFlow.map((s) => ({
  step: s.name,
  tokens: estimateTokens(s.text),
}));

const visionBreakdown = visionFlow.map((s) => ({
  step: s.name,
  imageTokens: estimateImageTokens(s.width, s.height),
  textTokens: estimateTokens(s.promptText),
  tokens: estimateImageTokens(s.width, s.height) + estimateTokens(s.promptText),
}));

const noVisionTotal = noVisionBreakdown.reduce((sum, s) => sum + s.tokens, 0);
const visionTotal   = visionBreakdown.reduce((sum, s) => sum + s.tokens, 0);
const savingsRatio  = visionTotal / Math.max(1, noVisionTotal);
const savedTokens   = visionTotal - noVisionTotal;

// ---------------------------------------------------------------------------
// Print results
// ---------------------------------------------------------------------------

console.log("\n## Podium Token Economics — 8-Step Flow Benchmark\n");
console.log(`iPhone 14 Pro resolution: ${SCREEN_W} × ${SCREEN_H} px`);
console.log(`Image tokens/screenshot: ${estimateImageTokens(SCREEN_W, SCREEN_H)} (capped at ${IMAGE_TOKEN_MAX})`);
console.log(`Formula: ceil((${SCREEN_W}×${SCREEN_H}) / ${IMAGE_PIXELS_PER_TOKEN}) = ${Math.ceil(SCREEN_W * SCREEN_H / IMAGE_PIXELS_PER_TOKEN)} → capped at ${IMAGE_TOKEN_MAX}\n`);

// Per-step comparison table
const col = (s, w) => String(s).padStart(w);
const colL = (s, w) => String(s).padEnd(w);

console.log(
  colL("Step", 20) +
  col("NoVision (tok)", 16) +
  col("Vision img (tok)", 18) +
  col("Vision txt (tok)", 18) +
  col("Vision total", 14)
);
console.log("-".repeat(86));

for (let i = 0; i < STEPS.length; i++) {
  const nv = noVisionBreakdown[i];
  const vl = visionBreakdown[i];
  console.log(
    colL(nv.step, 20) +
    col(nv.tokens, 16) +
    col(vl.imageTokens, 18) +
    col(vl.textTokens, 18) +
    col(vl.tokens, 14)
  );
}

console.log("-".repeat(86));
console.log(
  colL("TOTAL", 20) +
  col(noVisionTotal, 16) +
  col(visionBreakdown.reduce((s, r) => s + r.imageTokens, 0), 18) +
  col(visionBreakdown.reduce((s, r) => s + r.textTokens, 0), 18) +
  col(visionTotal, 14)
);

console.log(`\n**Savings ratio**: ${savingsRatio.toFixed(2)}× (vision costs ${savingsRatio.toFixed(2)}x more)`);
console.log(`**Tokens saved by Podium**: ${savedTokens.toLocaleString()} over 8 steps`);
console.log(`**Reduction**: ${(((visionTotal - noVisionTotal) / visionTotal) * 100).toFixed(1)}% fewer tokens with Podium\n`);

// Tool-def overhead section
const SAMPLE_TOOLS = Array.from({ length: 51 }, (_, i) => ({
  name: `podium_tool_${String(i + 1).padStart(2, "0")}`,
  description: `Perform mobile automation action number ${i + 1} on the target device element.`,
  schema: {
    type: "object",
    properties: {
      selector: { type: "string", description: "Element selector or label" },
      timeout:  { type: "number", description: "Timeout in milliseconds" },
    },
    required: ["selector"],
  },
}));

const toolOverhead = SAMPLE_TOOLS.reduce((sum, t) => {
  return sum + estimateTokens(t.name + t.description + JSON.stringify(t.schema));
}, 0);

console.log(`## Tool-Definition Overhead (${SAMPLE_TOOLS.length} tools)\n`);
console.log(`Total tokens for full tool schema block: ${toolOverhead.toLocaleString()}`);
console.log(`Per-tool average: ${(toolOverhead / SAMPLE_TOOLS.length).toFixed(1)} tokens`);
console.log(`This overhead is paid on EVERY model request regardless of which tool is called.\n`);

// Machine-readable JSON blob
const jsonOutput = {
  meta: {
    screenResolution: `${SCREEN_W}x${SCREEN_H}`,
    imageTokensPerScreenshot: estimateImageTokens(SCREEN_W, SCREEN_H),
    steps: STEPS.length,
    formula: "estimateTokens=ceil(len/4), estimateImageTokens=min(ceil(w*h/750),2048)",
  },
  flows: {
    noVision: { totalTokens: noVisionTotal, perStep: noVisionBreakdown },
    vision:   { totalTokens: visionTotal,   perStep: visionBreakdown   },
  },
  summary: {
    savingsRatio,
    savedTokens,
    reductionPercent: ((savedTokens / visionTotal) * 100).toFixed(1),
  },
  toolDefOverhead: {
    toolCount: SAMPLE_TOOLS.length,
    totalTokens: toolOverhead,
    perToolAverage: parseFloat((toolOverhead / SAMPLE_TOOLS.length).toFixed(1)),
  },
};

console.log("## JSON\n");
console.log(JSON.stringify(jsonOutput, null, 2));

import { defineConfig } from "vitest/config";

// Live canvas/WebGL bridge suite (`npm run test:canvas`). Launches Playwright
// WebKit (≈ WKWebView) and drives the REAL canvas-adapters bridge against real
// framework scene graphs — the coverage the mocked unit suite can't give.
// Browser launches are serialized and given a generous timeout.
export default defineConfig({
  test: {
    include: ["test/canvas-e2e/**/*.browser.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});

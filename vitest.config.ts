import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The live browser suite (WebKit) runs separately via `npm run test:canvas`.
    exclude: [...configDefaults.exclude, "test/canvas-e2e/**"],
  },
});

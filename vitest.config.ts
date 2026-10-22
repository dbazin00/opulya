import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.spec.ts",
      "scripts/**/*.test.ts",
    ],
    environment: "node",
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/unit",
      reporter: ["text", "html", "lcovonly", "json-summary"],
      include: [
        "apps/api/src/**/*.ts",
        "apps/web/src/**/*.{ts,tsx}",
        "packages/shared/src/**/*.ts",
      ],
      exclude: ["**/*.{test,spec}.ts", "**/*.d.ts", "**/generated/**"],
      reportOnFailure: true,
    },
  },
});

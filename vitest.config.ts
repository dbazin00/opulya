import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.spec.ts"],
    environment: "node",
  },
});

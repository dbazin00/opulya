import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next*/**",
      ".pnpm-store/**",
      "**/generated/**",
      ".runtime/**",
      ".npm-cache/**",
      "test-results/**",
      "apps/web/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mjs}"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        Buffer: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // E2E test build output (distDir set via E2E_DIST_DIR env var):
    ".next-e2e/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Honour the common _underscore convention for intentionally unused vars/args.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // test / setup files: any is legitimately needed for mocks and spy types.
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "vitest.setup.*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tailwindcss from "eslint-plugin-tailwindcss";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    ...tailwindcss.configs.recommended,
    settings: {
      ...tailwindcss.configs.recommended.settings,
      tailwindcss: {
        ...tailwindcss.configs.recommended.settings?.tailwindcss,
        cssConfigPath: "src/app/globals.css",
      },
    },
    rules: {
      ...tailwindcss.configs.recommended.rules,
      "tailwindcss/classnames-order": "off",
    },
  },
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

import { defineConfig } from "vitest/config";

/**
 * Three projects:
 *  - unit:        pure logic (search engine, sort config, helpers) — node, no DB.
 *  - integration: API route handlers + server helpers against an in-memory MongoDB.
 *                 Runs in a single fork with isolation off so one server/connection is
 *                 shared across all integration files.
 *  - jsdom:       React components, hooks, and contexts via Testing Library.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true
  },
  test: {
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      exclude: [
        "src/components/ui/**",
        "src/scripts/**",
        "e2e/**",
        "tests/**",
        "**/*.d.ts",
        "**/*.config.*",
        ".next/**"
      ]
    },
    projects: [
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "unit",
          environment: "node",
          globals: true,
          include: ["src/lib/**/*.test.ts"]
        }
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "integration",
          environment: "node",
          globals: true,
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["./tests/integration/setup.ts"],
          // Share one in-memory Mongo + connection across all integration files:
          // no isolation between files, run them sequentially in a single worker.
          isolate: false,
          fileParallelism: false,
          // Single-worker project must run in its own group (different maxWorkers
          // from the parallel projects).
          sequence: { groupOrder: 1 }
        }
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "jsdom",
          environment: "jsdom",
          globals: true,
          include: [
            "src/components/**/*.test.{ts,tsx}",
            "src/hooks/**/*.test.{ts,tsx}",
            "src/context/**/*.test.{ts,tsx}"
          ],
          setupFiles: ["./vitest.setup.jsdom.ts"]
        }
      }
    ]
  }
});
